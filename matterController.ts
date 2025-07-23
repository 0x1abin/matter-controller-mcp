#!/usr/bin/env node
/**
 * @license
 * Copyright 2022-2025 Matter.js Authors
 * SPDX-License-Identifier: MIT
 */

/**
 * Matter Controller MCP Server
 * Provides Matter device control capabilities through the Model Context Protocol
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
    Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { Diagnostic, Environment, Logger, singleton, StorageService, Time, Bytes } from "@matter/main";
import { BasicInformationCluster, DescriptorCluster, GeneralCommissioning, OnOff, LevelControl, ColorControl } from "@matter/main/clusters";
import { Ble, ClusterClientObj } from "@matter/main/protocol";
import { ManualPairingCodeCodec, NodeId } from "@matter/main/types";
import { ClusterId, getClusterById, getClusterNameById, resolveAttributeName } from "@matter/types";
import { NodeJsBle } from "@matter/nodejs-ble";
import { CommissioningController, NodeCommissioningOptions } from "@project-chip/matter.js";
import { getDeviceTypeDefinitionFromModelByCode } from "@project-chip/matter.js/device";


// Tool input schemas
const GetControllerStatusSchema = z.object({});

const CommissionDeviceSchema = z.object({
    pairingCode: z.string().optional().describe('Manual pairing code'),
    longDiscriminator: z.number().optional().describe('Long discriminator value'),
    setupPin: z.number().optional().describe('Setup PIN'),
    ip: z.string().optional().describe('Device IP address'),
    port: z.number().optional().describe('Device port'),
    ble: z.boolean().default(false).describe('Use BLE for commissioning'),
    wifiSsid: z.string().optional().describe('WiFi SSID for BLE commissioning'),
    wifiCredentials: z.string().optional().describe('WiFi credentials for BLE commissioning')
});

const GetCommissionedDevicesSchema = z.object({
    nodeId: z.string().optional().describe('Optional Node ID to get specific device info')
});

const GetDeviceInfoSchema = z.object({
    nodeId: z.string().describe('Node ID of the device')
});

const ControlOnOffDeviceSchema = z.object({
    nodeId: z.string().describe('Node ID of the device'),
    action: z.enum(['on', 'off', 'toggle']).describe('Action to perform'),
    endpointId: z.number().default(1).describe('Endpoint ID')
});

const ControlLevelDeviceSchema = z.object({
    nodeId: z.string().describe('Node ID of the device'),
    level: z.number().describe('Level value (0-254)'),
    endpointId: z.number().default(1).describe('Endpoint ID')
});

const ControlColorDeviceSchema = z.object({
    nodeId: z.string().describe('Node ID of the device'),
    colorTemperature: z.number().optional().describe('Color temperature in mireds (153-500, lower=cooler, higher=warmer)'),
    hue: z.number().optional().describe('Hue value (0-254)'),
    saturation: z.number().optional().describe('Saturation value (0-254)'),
    endpointId: z.number().default(1).describe('Endpoint ID')
});

const DecommissionDeviceSchema = z.object({
    nodeId: z.string().describe('Node ID of the device to decommission')
});

const ReadAttributesSchema = z.object({
    nodeId: z.string().describe('Node ID of the device'),
    endpointId: z.number().default(1).describe('Endpoint ID'),
    clusterId: z.number().describe('Cluster ID'),
    attributeIds: z.array(z.number()).optional().describe('Attribute IDs to read (if not provided, reads all available attributes in the cluster)')
});

const WriteAttributesSchema = z.object({
    nodeId: z.string().describe('Node ID of the device'),
    endpointId: z.number().default(1).describe('Endpoint ID'),
    clusterId: z.number().describe('Cluster ID'),
    attributes: z.record(z.string(), z.any()).describe('Attributes to write as key-value pairs (key is attribute ID as string, value is the attribute value)')
});

// Tool names enum
enum ToolName {
    GET_CONTROLLER_STATUS = 'get_controller_status',
    COMMISSION_DEVICE = 'commission_device',
    DECOMMISSION_DEVICE = 'decommission_device',
    GET_COMMISSIONED_DEVICES = 'get_commissioned_devices',
    GET_DEVICE_INFO = 'get_device_info',
    CONTROL_ONOFF_DEVICE = 'control_onoff_device',
    CONTROL_LEVEL_DEVICE = 'control_level_device',
    CONTROL_COLOR_DEVICE = 'control_color_device',
    WRITE_ATTRIBUTES = 'write_attributes',
    READ_ATTRIBUTES = 'read_attributes',
}

// Global variables for the MCP server instance
let logger: Logger;
let environment: Environment;
let storageService: StorageService;
let commissioningController: CommissioningController | null = null;
let controllerUniqueId: string = '';
let adminFabricLabel: string = '';

// Configure logging
function configureLogging() {
    try {
        const logLevel = process.env.MATTER_LOG_LEVEL || 'info';
        
        // Configure the logger format
        Logger.defaultLogLevel = logLevel as any;
        Logger.log = (level: any, formattedLog: string) => {
            // Use console.error for logging to avoid interfering with responses
            console.error(`[${level}] ${formattedLog}`);
        };
        
    } catch (error) {
        console.error('Failed to configure logging:', error);
    }
}

function serializeJson(data: any) {
    return JSON.stringify(data, (key, value) => {
        if (key === 'nodeId' && typeof value != 'string') {
            return NodeIdUtils.nodeIdToString(value);
        }
        if (typeof value === "bigint") {
            return value.toString();
        }
        if (value instanceof Uint8Array) {
            return Bytes.toHex(value);
        }
        if (value === undefined) {
            return "undefined";
        }
        return value;
    });
}

// Unified NodeId encoding/decoding utilities based on NodeId.ts
namespace NodeIdUtils {
    /**
     * Parse hex string to NodeId
     */
    export function fromHexString(hexString: string): ReturnType<typeof NodeId> {
        // Remove '0x' prefix if present
        const cleanHex = hexString.replace(/^0x/i, '');
        
        // Convert hex string to BigInt and create NodeId
        return NodeId(BigInt('0x' + cleanHex));
    }

    /**
     * Convert NodeId to hex string using the standard NodeId.toHexString method
     */
    export function toHexString(nodeId: ReturnType<typeof NodeId>): string {
        return NodeId.toHexString(nodeId);
    }

    /**
     * Parse input to NodeId, handling string inputs as hex strings
     */
    export function parseNodeId(input: string): ReturnType<typeof NodeId> {
        if (typeof input === 'string') {
            // Check if it's a hex string (contains letters A-F)
            if (/[A-Fa-f]/.test(input)) {
                return fromHexString(input);
            } else {
                // Treat as decimal string
                return NodeId(BigInt(input));
            }
        }
        throw new Error(`Invalid NodeId input: ${input}`);
    }

    /**
     * Convert NodeId to string representation for consistent serialization
     * Uses decimal string format for compatibility
     */
    export function nodeIdToString(nodeId: ReturnType<typeof NodeId>): string {
        return toHexString(nodeId);
    }

    /**
     * Convert NodeId array to string array for serialization
     */
    export function serializeNodeIds(nodeIds: ReturnType<typeof NodeId>[]): string[] {
        return nodeIds.map(nodeId => nodeIdToString(nodeId));
    }

    /**
     * Validate and normalize NodeId input from MCP protocol
     * Always returns decimal string format
     */
    export function validateAndNormalizeNodeId(input: string): string {
        try {
            const nodeId = parseNodeId(input);
            return nodeIdToString(nodeId);
        } catch (error) {
            throw new Error(`Invalid NodeId format: ${input}`);
        }
    }
}

// Auto-initialize the Matter controller
async function autoInitializeController() {
    try {
        logger.info('Auto-initializing Matter controller with default parameters...');
        
        const controllerStorage = (await storageService.open("controller")).createContext("data");
        
        // Use environment variables or generate defaults
        controllerUniqueId = process.env.MATTER_UNIQUE_ID || 
            (await controllerStorage.has("uniqueid") ? await controllerStorage.get<string>("uniqueid") : Time.nowMs().toString());
        await controllerStorage.set("uniqueid", controllerUniqueId);
        
        adminFabricLabel = process.env.MATTER_ADMIN_FABRIC_LABEL || 
            (await controllerStorage.has("fabriclabel") ? await controllerStorage.get<string>("fabriclabel") : "Matter Controller MCP");
        await controllerStorage.set("fabriclabel", adminFabricLabel);

        commissioningController = new CommissioningController({
            environment: {
                environment: environment,
                id: controllerUniqueId,
            },
            autoConnect: true,
            adminFabricLabel: adminFabricLabel,
        });

        await commissioningController.start();
        
        logger.info(`Matter Controller auto-initialized successfully with ID: ${controllerUniqueId}`);
        
    } catch (error) {
        logger.error('Failed to auto-initialize Matter controller:', error);
        throw error;
    }
}

// Setup the Matter controller and environment
async function setupMatterEnvironment() {
    // Initialize configuration manager (removed since it was causing linter errors)
    
    // Configure logging
    configureLogging();
    
    logger = Logger.get("MatterControllerMCP");
    environment = Environment.default;
    storageService = environment.get(StorageService);
    
    // Initialize BLE if enabled
    if (environment.vars.get("ble")) {
        Ble.get = singleton(
            () =>
                new NodeJsBle({
                    environment: environment,
                    hciId: environment.vars.number("ble.hci.id"),
                }),
        );
    }

    // Auto-initialize the Matter controller
    await autoInitializeController();
}

// Helper function to ensure device is connected before operation
async function ensureDeviceConnected(nodeIdInput: string): Promise<any> {
    // Normalize the nodeId to string format
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(nodeIdInput);
    
    if (!commissioningController) {
        throw new McpError(ErrorCode.InvalidRequest, "Controller not initialized");
    }
    
    try {
        const nodeId = NodeIdUtils.parseNodeId(nodeIdString);
        const node = await commissioningController.getNode(nodeId);
        
        // Check if device is already connected
        if (node.isConnected) {
            return node;
        }
        
        logger.info(`Device ${nodeIdString} not connected, connecting now...`);

        // Connect if not already connected
        if (!node.isConnected) {
            await node.connect();
        }

        logger.info(`Successfully connected to device ${nodeIdString}`);
        
        return node;
    } catch (error) {
        logger.error(`Failed to connect to device ${nodeIdString}: ${error}`);
        throw new McpError(ErrorCode.InternalError, `Failed to connect to device: ${error}`);
    }
}

// Tool handler functions
async function handleGetControllerStatus(args: any) {
    const validatedArgs = GetControllerStatusSchema.parse(args);
    
    // Count connected devices using matter.js API
    let connectedDevicesCount = 0;
    if (commissioningController) {
        const nodes = commissioningController.getCommissionedNodes();
        for (const nodeId of nodes) {
            try {
                const node = await commissioningController.getNode(nodeId);
                if (node.isConnected) {
                    connectedDevicesCount++;
                }
            } catch (error) {
                // Skip counting if node cannot be accessed
            }
        }
    }
    
    return {
        content: [
            {
                type: 'text',
                text: JSON.stringify({
                    uniqueId: controllerUniqueId || 'not set',
                    adminFabricLabel: adminFabricLabel || 'not set',
                    commissioning: commissioningController !== null,
                    commissionedDevices: commissioningController?.getCommissionedNodes().length || 0,
                    connectedDevices: connectedDevicesCount,
                }, null, 2)
            }
        ]
    };
}

async function handleCommissionDevice(args: any) {
    const validatedArgs = CommissionDeviceSchema.parse(args);
    
    if (!commissioningController) {
        throw new McpError(ErrorCode.InvalidRequest, "Controller not initialized");
    }

    try {
        let longDiscriminator: number | undefined;
        let setupPin: number;
        let shortDiscriminator: number | undefined;

        if (validatedArgs.pairingCode) {
            const pairingCodeCodec = ManualPairingCodeCodec.decode(validatedArgs.pairingCode);
            shortDiscriminator = pairingCodeCodec.shortDiscriminator;
            longDiscriminator = undefined;
            setupPin = pairingCodeCodec.passcode;
        } else {
            longDiscriminator = validatedArgs.longDiscriminator || 3840;
            setupPin = validatedArgs.setupPin || 20202021;
        }

        const commissioningOptions: NodeCommissioningOptions["commissioning"] = {
            regulatoryLocation: GeneralCommissioning.RegulatoryLocationType.IndoorOutdoor,
            regulatoryCountryCode: "XX",
        };

        if (validatedArgs.ble && validatedArgs.wifiSsid && validatedArgs.wifiCredentials) {
            commissioningOptions.wifiNetwork = {
                wifiSsid: validatedArgs.wifiSsid,
                wifiCredentials: validatedArgs.wifiCredentials,
            };
        }

        const options: NodeCommissioningOptions = {
            commissioning: commissioningOptions,
            discovery: {
                knownAddress: validatedArgs.ip && validatedArgs.port ? { ip: validatedArgs.ip, port: validatedArgs.port, type: "udp" } : undefined,
                identifierData: longDiscriminator !== undefined ? { longDiscriminator } : shortDiscriminator !== undefined ? { shortDiscriminator } : {},
                discoveryCapabilities: { ble: validatedArgs.ble || false },
            },
            passcode: setupPin,
        };

        const nodeId = await commissioningController.commissionNode(options);
        
        // Automatically connect to newly commissioned device
        const nodeIdString = NodeIdUtils.nodeIdToString(nodeId);
        await ensureDeviceConnected(nodeIdString);

        return {
            content: [
                {
                    type: 'text',
                    text: `Device commissioned successfully with Node ID: ${nodeIdString} and automatically connected`
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to commission device: ${error}`);
    }
}

async function handleGetCommissionedDevices(args: any) {
    const validatedArgs = GetCommissionedDevicesSchema.parse(args);
    
    if (!commissioningController) {
        throw new McpError(ErrorCode.InvalidRequest, "Controller not initialized");
    }

    try {
        let nodes = commissioningController.getCommissionedNodes();
        let nodeDetails: any[] = commissioningController.getCommissionedNodesDetails();

        // Return all nodes if no specific nodeId is requested
        if (validatedArgs.nodeId) {
            const requestedNodeId = NodeIdUtils.parseNodeId(validatedArgs.nodeId);
            if (!nodes.includes(requestedNodeId)) {
                throw new McpError(ErrorCode.InvalidRequest, `Node ${requestedNodeId} is not commissioned`);
            }
            nodes = [requestedNodeId];
            nodeDetails = nodeDetails.find((node: any) => node.nodeId === requestedNodeId);
        }

        const serializedNodes = NodeIdUtils.serializeNodeIds(nodes);

        // Add connection status to the details
        const connectionStatus: any[] = [];
        for (const nodeId of nodes) {
            try {
                const node = await commissioningController.getNode(nodeId);
                connectionStatus.push({
                    nodeId,
                    connected: node.isConnected,
                });
            } catch (error) {
                connectionStatus.push({
                    nodeId,
                    connected: false,
                    error: `Failed to get node status: ${error}`
                });
            }

        }

        // Add node descriptor to the details
        const nodeDescriptor: any[] = [];
        for (const nodeId of nodes) {
            const node = await commissioningController.getNode(nodeId);
            const descriptor = node.getRootClusterClient(DescriptorCluster);
            if (descriptor) {
                const _deviceTypeList = await descriptor.getDeviceTypeListAttribute();
                const serverList = await descriptor.getServerListAttribute();
                const clientList = await descriptor.getClientListAttribute();
                const partsList = await descriptor.getPartsListAttribute();

                const deviceTypeList = _deviceTypeList.map((item: any) => {
                    const deviceTypeDefinition = getDeviceTypeDefinitionFromModelByCode(item.deviceType);
                    return {
                        deviceType: item.deviceType,
                        revision: item.revision,
                        deviceTypeName: deviceTypeDefinition?.name,
                        deviceClass: deviceTypeDefinition?.deviceClass,
                    }
                });
                const serverNames = serverList.map((id: any) => `${id}: ${getClusterNameById(ClusterId(id))}`);
                const clientNames = clientList.map((id: any) => `${id}: ${getClusterNameById(ClusterId(id))}`);

                nodeDescriptor.push({
                    nodeId,
                    deviceTypeList,
                    serverList,
                    serverNames,
                    clientList,
                    clientNames,
                    endpointList: partsList,
                });
            }
        }

        const result = {
            summary: "Matter Commissioned Devices status and details",
            nodeList: serializedNodes,
            connectionStatus: connectionStatus,
            descriptor: nodeDescriptor,
            details: nodeDetails
        }

        return {
            content: [
                {
                    type: 'text',
                    text: serializeJson(result)
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to get commissioned devices: ${error}`);
    }
}

async function handleGetDeviceInfo(args: any) {
    const validatedArgs = GetDeviceInfoSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const info = node.getRootClusterClient(BasicInformationCluster);
        const descriptor = node.getRootClusterClient(DescriptorCluster);
        
        let deviceInfo: any = {
            nodeId: nodeIdString,
            basicInformation: {},
            rootEndpoint: {},
            endpoints: []
        };

        // Get basic information from root endpoint
        if (info) {
            deviceInfo.basicInformation.productName = await info.getProductNameAttribute();
            deviceInfo.basicInformation.vendorName = await info.getVendorNameAttribute();
            deviceInfo.basicInformation.hardwareVersion = await info.getHardwareVersionAttribute();
            deviceInfo.basicInformation.softwareVersion = await info.getSoftwareVersionAttribute();
            deviceInfo.basicInformation.vendorId = await info.getVendorIdAttribute();
            deviceInfo.basicInformation.productId = await info.getProductIdAttribute();
            deviceInfo.basicInformation.serialNumber = await info.getSerialNumberAttribute();
        }

        // Get root endpoint descriptor information
        if (descriptor) {
            deviceInfo.rootEndpoint.deviceTypeList = await descriptor.getDeviceTypeListAttribute();
            deviceInfo.rootEndpoint.serverList = await descriptor.getServerListAttribute();
            deviceInfo.rootEndpoint.clientList = await descriptor.getClientListAttribute();
            deviceInfo.rootEndpoint.partsList = await descriptor.getPartsListAttribute();
        }

        // Get all functional endpoints (devices)
        const devices = node.getDevices();
        for (const device of devices) {
            const endpointInfo: any = {
                endpointId: device.number,
                deviceTypes: [],
                clusters: {
                    servers: [],
                    clients: []
                }
            };

            // Get device types
            try {
                const deviceTypes = device.getDeviceTypes();
                endpointInfo.deviceTypes = deviceTypes.map((dt: any) => ({
                    code: dt.code,
                    name: dt.name,
                    revision: dt.revision
                }));
            } catch (error) {
                logger.debug(`Failed to get device types for endpoint ${device.number}: ${error}`);
            }

            // Get descriptor information for this endpoint
            const endpointDescriptor = device.getClusterClient(DescriptorCluster);
            if (endpointDescriptor) {
                try {
                    // Get server list from descriptor
                    const serverList = await endpointDescriptor.getServerListAttribute();
                    const clientList = await endpointDescriptor.getClientListAttribute();

                    // Process server clusters - get real cluster names using matter.js API
                    for (const clusterId of serverList) {
                        const cluster = getClusterById(clusterId);
                        endpointInfo.clusters.servers.push({
                            id: clusterId,
                            name: cluster.name,
                            revision: cluster.revision,
                            features: cluster.features,
                            attributes: cluster.attributes,
                            commands: cluster.commands,
                            events: cluster.events
                        });
                    }

                    // Process client clusters - get real cluster names using matter.js API
                    for (const clusterId of clientList) {
                        const cluster = getClusterById(clusterId);
                        endpointInfo.clusters.clients.push({
                            id: clusterId,
                            name: cluster.name,
                            revision: cluster.revision,
                            features: cluster.features,
                            attributes: cluster.attributes,
                            commands: cluster.commands,
                            events: cluster.events
                        });
                    }
                } catch (error) {
                    logger.debug(`Failed to get descriptor information for endpoint ${device.number}: ${error}`);
                }
            }

            deviceInfo.endpoints.push(endpointInfo);
        }

        // Convert any BigInt values to strings for JSON serialization
        const processedDeviceInfo = serializeJson(deviceInfo);

        return {
            content: [
                {
                    type: 'text',
                    text: `Device ${nodeIdString} detailed information:\n${processedDeviceInfo}`
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to get device info: ${error}`);
    }
}

async function handleControlOnOffDevice(args: any) {
    const validatedArgs = ControlOnOffDeviceSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const devices = node.getDevices();
        const device = devices.find((d: any) => d.number === validatedArgs.endpointId);

        if (!device) {
            throw new McpError(ErrorCode.InvalidRequest, `Endpoint ${validatedArgs.endpointId} not found`);
        }

        const onOff: ClusterClientObj<OnOff.Complete> | undefined = device.getClusterClient(OnOff.Complete);
        if (!onOff) {
            throw new McpError(ErrorCode.InvalidRequest, `OnOff cluster not available on device ${nodeIdString}`);
        }

        let result: string;
        switch (validatedArgs.action) {
            case 'on':
                await onOff.on();
                result = 'Device turned on';
                break;
            case 'off':
                await onOff.off();
                result = 'Device turned off';
                break;
            case 'toggle':
                await onOff.toggle();
                result = 'Device toggled';
                break;
            default:
                throw new McpError(ErrorCode.InvalidRequest, `Invalid action: ${validatedArgs.action}`);
        }

        return {
            content: [
                {
                    type: 'text',
                    text: result
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to control device: ${error}`);
    }
}

async function handleControlLevelDevice(args: any) {
    const validatedArgs = ControlLevelDeviceSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const devices = node.getDevices();
        const device = devices.find((d: any) => d.number === validatedArgs.endpointId);

        if (!device) {
            throw new McpError(ErrorCode.InvalidRequest, `Endpoint ${validatedArgs.endpointId} not found`);
        }

        const levelControl: ClusterClientObj<LevelControl.Complete> | undefined = device.getClusterClient(LevelControl.Complete);
        if (!levelControl) {
            throw new McpError(ErrorCode.InvalidRequest, `LevelControl cluster not available on device ${nodeIdString}`);
        }

        await levelControl.moveToLevel({ 
            level: validatedArgs.level, 
            transitionTime: 0, 
            optionsMask: {}, 
            optionsOverride: {} 
        });

        return {
            content: [
                {
                    type: 'text',
                    text: `Device level set to ${validatedArgs.level}`
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to control device level: ${error}`);
    }
}

async function handleControlColorDevice(args: any) {
    const validatedArgs = ControlColorDeviceSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const devices = node.getDevices();
        const device = devices.find((d: any) => d.number === validatedArgs.endpointId);

        if (!device) {
            throw new McpError(ErrorCode.InvalidRequest, `Endpoint ${validatedArgs.endpointId} not found`);
        }

        const colorControl: ClusterClientObj<ColorControl.Complete> | undefined = device.getClusterClient(ColorControl.Complete);
        if (!colorControl) {
            throw new McpError(ErrorCode.InvalidRequest, `ColorControl cluster not available on device ${nodeIdString}`);
        }

        let result = '';

        // Handle color temperature control (for warm/cool white)
        if (validatedArgs.colorTemperature !== undefined) {
            await colorControl.moveToColorTemperature({ 
                colorTemperatureMireds: validatedArgs.colorTemperature, 
                transitionTime: 0, 
                optionsMask: {}, 
                optionsOverride: {} 
            });
            result += `Color temperature set to ${validatedArgs.colorTemperature} mireds`;
        }

        // Handle hue and saturation control (for colored lights)
        if (validatedArgs.hue !== undefined && validatedArgs.saturation !== undefined) {
            await colorControl.moveToHueAndSaturation({ 
                hue: validatedArgs.hue, 
                saturation: validatedArgs.saturation, 
                transitionTime: 0, 
                optionsMask: {}, 
                optionsOverride: {} 
            });
            result += `${result ? ' and ' : ''}Hue set to ${validatedArgs.hue}, Saturation set to ${validatedArgs.saturation}`;
        } else if (validatedArgs.hue !== undefined) {
            await colorControl.moveToHue({ 
                hue: validatedArgs.hue, 
                direction: 0, // 0 = shortest distance
                transitionTime: 0, 
                optionsMask: {}, 
                optionsOverride: {} 
            });
            result += `${result ? ' and ' : ''}Hue set to ${validatedArgs.hue}`;
        } else if (validatedArgs.saturation !== undefined) {
            await colorControl.moveToSaturation({ 
                saturation: validatedArgs.saturation, 
                transitionTime: 0, 
                optionsMask: {}, 
                optionsOverride: {} 
            });
            result += `${result ? ' and ' : ''}Saturation set to ${validatedArgs.saturation}`;
        }

        if (!result) {
            throw new McpError(ErrorCode.InvalidRequest, 'At least one color parameter (colorTemperature, hue, or saturation) must be provided');
        }

        return {
            content: [
                {
                    type: 'text',
                    text: result
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to control device color: ${error}`);
    }
}

async function handleDecommissionDevice(args: any) {
    const validatedArgs = DecommissionDeviceSchema.parse(args);
    
    if (!commissioningController) {
        throw new McpError(ErrorCode.InvalidRequest, "Controller not initialized");
    }

    try {
        const nodeId = NodeIdUtils.parseNodeId(validatedArgs.nodeId);
        const nodeIdString = NodeIdUtils.nodeIdToString(nodeId);
        
        // Check if the node is commissioned
        const commissionedNodes = commissioningController.getCommissionedNodes();
        const nodeExists = commissionedNodes.some(commissionedNodeId => 
            NodeIdUtils.nodeIdToString(commissionedNodeId) === nodeIdString
        );
        
        if (!nodeExists) {
            throw new McpError(ErrorCode.InvalidRequest, `Node ${nodeIdString} is not commissioned`);
        }
        
        // Ensure the device is connected before attempting to remove it
        let node: any = null;
        try {
            logger.info(`Connecting to device ${nodeIdString} for decommissioning...`);
            node = await ensureDeviceConnected(nodeIdString);
        } catch (error) {
            logger.warn(`Failed to connect to device ${nodeIdString} for decommissioning: ${error}`);
            // Continue with removal even if connection fails
        }
        
        // Remove the node from the commissioned nodes while connected
        try {
            logger.info(`Removing node ${nodeIdString} from commissioning controller...`);
            await commissioningController.removeNode(nodeId);
            logger.info(`Successfully removed node ${nodeIdString} from commissioning controller`);
        } catch (error) {
            logger.warn(`Failed to remove node ${nodeIdString} from commissioning controller: ${error}`);
            // Continue with cleanup even if removal fails
        }
        
        // Now disconnect and clean up local state
        if (node && node.isConnected) {
            try {
                logger.info(`Disconnecting from node ${nodeIdString}...`);
                await node.disconnect();
                logger.info(`Successfully disconnected from node ${nodeIdString}`);
            } catch (error) {
                logger.warn(`Failed to disconnect from node ${nodeIdString}: ${error}`);
            }
        }
        
        return {
            content: [
                {
                    type: 'text',
                    text: `Device with Node ID ${validatedArgs.nodeId} has been decommissioned successfully. Note: For complete removal, the device should also be factory reset.`
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to decommission device: ${error}`);
    }
}

async function handleWriteAttributes(args: any) {
    const validatedArgs = WriteAttributesSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const devices = node.getDevices();
        const device = devices.find((d: any) => d.number === validatedArgs.endpointId);

        if (!device) {
            throw new McpError(ErrorCode.InvalidRequest, `Endpoint ${validatedArgs.endpointId} not found`);
        }

        // Get the cluster client for the specified cluster ID
        const clusterClient = device.getClusterClient({ id: validatedArgs.clusterId });
        if (!clusterClient) {
            throw new McpError(ErrorCode.InvalidRequest, `Cluster ${validatedArgs.clusterId} not available on device ${nodeIdString} endpoint ${validatedArgs.endpointId}`);
        }

        const results: any = {
            nodeId: nodeIdString,
            endpointId: validatedArgs.endpointId,
            clusterId: validatedArgs.clusterId,
            writeResults: {}
        };

        // Write each attribute
        for (const [attributeIdStr, value] of Object.entries(validatedArgs.attributes)) {
            const attributeId = parseInt(attributeIdStr);
            try {
                await clusterClient.setAttribute(attributeId, value);
                results.writeResults[attributeId] = { success: true, message: 'Attribute written successfully' };
                logger.info(`Successfully wrote attribute ${attributeId} with value ${JSON.stringify(value)} to cluster ${validatedArgs.clusterId}`);
            } catch (error) {
                logger.error(`Failed to write attribute ${attributeId} to cluster ${validatedArgs.clusterId}: ${error}`);
                results.writeResults[attributeId] = { success: false, error: `Failed to write: ${error}` };
            }
        }

        // Convert any BigInt values to strings for JSON serialization
        const processedResults = serializeJson(results);

        return {
            content: [
                {
                    type: 'text',
                    text: `Attributes write results for device ${nodeIdString}:\n${processedResults}`
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to write attributes: ${error}`);
    }
}

async function handleReadAttributes(args: any) {
    const validatedArgs = ReadAttributesSchema.parse(args);
    
    // Use the unified validation method
    const nodeIdString = NodeIdUtils.validateAndNormalizeNodeId(validatedArgs.nodeId);
    const node = await ensureDeviceConnected(nodeIdString);

    try {
        const allAttributes = await node.readAllAttributes();
        
        // Filter attributes by endpoint and cluster
        const clusterAttributes = allAttributes.filter(item => 
            item.path.endpointId === validatedArgs.endpointId &&
            item.path.clusterId === validatedArgs.clusterId
        );

        let filteredAttributes;
        
        if (validatedArgs.attributeIds && validatedArgs.attributeIds.length > 0) {
            // Read only specified attributes
            filteredAttributes = clusterAttributes.filter(item => 
                validatedArgs.attributeIds!.includes(item.path.attributeId)
            );
            
            // Check if all requested attributes were found
            const foundAttributeIds = filteredAttributes.map(attr => attr.path.attributeId);
            const missingAttributes = validatedArgs.attributeIds.filter(id => !foundAttributeIds.includes(id));
            
            if (missingAttributes.length > 0) {
                logger.warn(`Some requested attributes were not found: ${missingAttributes.join(', ')}`);
            }
        } else {
            // Read all attributes in the cluster
            filteredAttributes = clusterAttributes;
        }

        if (filteredAttributes.length === 0) {
            const message = validatedArgs.attributeIds 
                ? `No requested attributes found on endpoint ${validatedArgs.endpointId} of cluster ${validatedArgs.clusterId}`
                : `No attributes found on endpoint ${validatedArgs.endpointId} of cluster ${validatedArgs.clusterId}`;
            throw new McpError(ErrorCode.InvalidRequest, message);
        }

        // Transform raw Matter.js attribute data into optimized structure
        let attributes: any[] = [];
        filteredAttributes.map(attr => (
            attributes.push(
                {
                    id: attr.path.attributeId,
                    value: Diagnostic.json(attr.value),
                    version: attr.version
                }
            )
        ))

        const result = {
            summary: `Attributes read results for device ${nodeIdString} (endpoint ${validatedArgs.endpointId}, cluster ${validatedArgs.clusterId})`,
            nodeId: nodeIdString,
            endpointId: validatedArgs.endpointId,
            clusterId: validatedArgs.clusterId,
            attributes,
        }

        return {
            content: [
                {
                    type: 'text',
                    text: serializeJson(result)
                }
            ]
        };
    } catch (error) {
        throw new McpError(ErrorCode.InternalError, `Failed to read attributes: ${error}`);
    }
}

// Main createServer function
export const createServer = () => {

    const server = new Server(
        {
            name: 'matter-controller',
            version: '0.1.0',
            description: 'Matter device controller MCP server',
        },
        {
            capabilities: {
                tools: {},
            },
        }
    );

    // Setup tool handlers
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        return {
            tools: [
                {
                    name: ToolName.GET_CONTROLLER_STATUS,
                    description: 'Get the current status of the Matter controller (automatically initialized on startup)',
                    inputSchema: zodToJsonSchema(GetControllerStatusSchema)
                },
                {
                    name: ToolName.COMMISSION_DEVICE,
                    description: 'Commission a new Matter device',
                    inputSchema: zodToJsonSchema(CommissionDeviceSchema)
                },
                {
                    name: ToolName.GET_COMMISSIONED_DEVICES,
                    description: 'Get list of commissioned devices (optionally filter by specific nodeId)',
                    inputSchema: zodToJsonSchema(GetCommissionedDevicesSchema)
                },
                {
                    name: ToolName.GET_DEVICE_INFO,
                    description: 'Get detailed information about a device',
                    inputSchema: zodToJsonSchema(GetDeviceInfoSchema)
                },
                {
                    name: ToolName.CONTROL_ONOFF_DEVICE,
                    description: 'Control on/off state of a device',
                    inputSchema: zodToJsonSchema(ControlOnOffDeviceSchema)
                },
                {
                    name: ToolName.CONTROL_LEVEL_DEVICE,
                    description: 'Control level (brightness/dimming) of a device',
                    inputSchema: zodToJsonSchema(ControlLevelDeviceSchema)
                },
                {
                    name: ToolName.CONTROL_COLOR_DEVICE,
                    description: 'Control color temperature and color of a device',
                    inputSchema: zodToJsonSchema(ControlColorDeviceSchema)
                },
                {
                    name: ToolName.DECOMMISSION_DEVICE,
                    description: 'Decommission a commissioned Matter device',
                    inputSchema: zodToJsonSchema(DecommissionDeviceSchema)
                },
                {
                    name: ToolName.WRITE_ATTRIBUTES,
                    description: 'Write attributes to a device cluster (supports batch writing)',
                    inputSchema: zodToJsonSchema(WriteAttributesSchema)
                },
                {
                    name: ToolName.READ_ATTRIBUTES,
                    description: 'Read attributes from a device cluster (can read specific attributes or all attributes in a cluster)',
                    inputSchema: zodToJsonSchema(ReadAttributesSchema)
                }
            ] as Tool[]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            switch (name) {
                case ToolName.GET_CONTROLLER_STATUS:
                    return await handleGetControllerStatus(args);
                case ToolName.COMMISSION_DEVICE:
                    return await handleCommissionDevice(args);
                case ToolName.GET_COMMISSIONED_DEVICES:
                    return await handleGetCommissionedDevices(args);
                case ToolName.GET_DEVICE_INFO:
                    return await handleGetDeviceInfo(args);
                case ToolName.CONTROL_ONOFF_DEVICE:
                    return await handleControlOnOffDevice(args);
                case ToolName.CONTROL_LEVEL_DEVICE:
                    return await handleControlLevelDevice(args);
                case ToolName.CONTROL_COLOR_DEVICE:
                    return await handleControlColorDevice(args);
                case ToolName.DECOMMISSION_DEVICE:
                    return await handleDecommissionDevice(args);
                case ToolName.WRITE_ATTRIBUTES:
                    return await handleWriteAttributes(args);
                case ToolName.READ_ATTRIBUTES:
                    return await handleReadAttributes(args);
                default:
                    throw new McpError(
                        ErrorCode.MethodNotFound,
                        `Unknown tool: ${name}`
                    );
            }
        } catch (error) {
            logger.error(`Error handling tool ${name}:`, error);
            throw new McpError(
                ErrorCode.InternalError,
                `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });

    server.onerror = (error) => {
        logger.error('MCP Server error:', error);
    };

    // Cleanup function
    const cleanup = async () => {
        logger.info('Cleaning up Matter Controller MCP server...');
        
        // Close all connections
        if (commissioningController) {
            try {
                // First disconnect all nodes
                const nodes = commissioningController.getCommissionedNodes();
                for (const nodeId of nodes) {
                    try {
                        const node = await commissioningController.getNode(nodeId);
                        if (node.isConnected) {
                            await node.disconnect();
                        }
                    } catch (error) {
                        logger.error(`Error disconnecting from node ${nodeId}:`, error);
                    }
                }
                
                // Then close the controller
                await commissioningController.close();
            } catch (error) {
                logger.error('Error closing commissioning controller:', error);
            }
        }
    };

    setupMatterEnvironment();

    console.log('Matter controller created');

    return { server, cleanup };
}; 