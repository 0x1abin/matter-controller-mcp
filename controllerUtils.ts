import { Bytes, Diagnostic, LogFormat } from "@matter/main";
import { NodeId } from "@matter/types";


// Unified NodeId encoding/decoding utilities based on NodeId.ts
export namespace NodeIdUtils {
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
     * Validate and normalize NodeId input from MCP protocol
     * Always returns decimal string format
     */
    export function validateAndNormalizeNodeId(input: string): string {
        try {
            const nodeId = parseNodeId(input);
            return NodeId.toHexString(nodeId);
        } catch (error) {
            throw new Error(`Invalid NodeId format: ${input}`);
        }
    }
}

/**
 * Get the node structure as a formatted string using the diagnostic system
 * 
 * @param node - The PairedNode instance
 * @param format - The format to use: 'plain' for plain text, 'ansi' for colored text
 * @returns A formatted string representation of the node structure with duplicate attributes filtered
 * 
 * Usage examples:
 * - const plainStructure = getNodeStructureInfo(node);
 * - const coloredStructure = getNodeStructureInfo(node, 'ansi');
 */
export function getNodeStructureInfo(node: any, format: 'plain' | 'ansi' = 'plain'): string {
    // Choose formatter based on the format parameter
    const formatter = format === 'ansi' ? LogFormat.formats.ansi : LogFormat.formats.plain;
    
    // Get the diagnostic value from the node (this is what logStructure() uses internally)
    const diagnosticValue = node[Diagnostic.value];
    
    // Format it as a string with no indentation
    const rawStructure = formatter(diagnosticValue, 0);
    
    // Filter duplicate attributes and return
    return filterDuplicateAttributes(rawStructure);
}

/**
 * Filter duplicate attributes from the structure string
 * This function removes repeated attribute entries within each cluster's attributes section
 */
function filterDuplicateAttributes(structureString: string): string {
    const lines = structureString.split('\n');
    const filteredLines: string[] = [];
    let inAttributesSection = false;
    let currentClusterAttributes = new Set<string>();
    let attributesSectionStartIndex = -1;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // Check if we're entering an attributes section
        if (trimmedLine === 'attributes') {
            inAttributesSection = true;
            currentClusterAttributes.clear();
            attributesSectionStartIndex = filteredLines.length;
            filteredLines.push(line);
            continue;
        }
        
        // Check if we're leaving an attributes section
        if (inAttributesSection && (
            trimmedLine === 'commands' || 
            trimmedLine === 'events' || 
            trimmedLine.startsWith('clients') ||
            trimmedLine.startsWith('childs') ||
            (trimmedLine.includes('endpoint#:') && trimmedLine.includes('type:')) ||
            (line.length > 0 && !line.startsWith('  ') && !line.startsWith('\t'))
        )) {
            inAttributesSection = false;
            currentClusterAttributes.clear();
        }
        
        // If we're in attributes section, check for duplicates
        if (inAttributesSection && trimmedLine.includes(' id: 0x')) {
            // Extract attribute name and ID
            const attributeMatch = trimmedLine.match(/^(\w+)\s+id:\s+(0x[a-fA-F0-9]+)/);
            if (attributeMatch) {
                const attributeName = attributeMatch[1];
                const attributeId = attributeMatch[2];
                const attributeKey = `${attributeName}_${attributeId}`;
                
                // Skip if we've already seen this attribute in this cluster
                if (currentClusterAttributes.has(attributeKey)) {
                    continue;
                }
                currentClusterAttributes.add(attributeKey);
            }
        }
        
        filteredLines.push(line);
    }
    
    return filteredLines.join('\n');
}

export function serializeJson(data: any) {
    return JSON.stringify(data, (key, value) => {
        if (key === 'nodeId' && typeof value != 'string') {
            return NodeId.toHexString(value);
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

/**
 * Recursively find all devices in a node, including nested child endpoints (aggregator pattern)
 */
export function findAllDevices(node: any): Array<{ endpoint: number; device: any; path: string }> {
    const allDevices: Array<{ endpoint: number; device: any; path: string }> = [];
    
    function traverseDevices(devices: any[], parentPath: string = '') {
        for (const device of devices) {
            const currentPath = parentPath + `endpoint-${device.number}`;
            allDevices.push({
                endpoint: device.number,
                device: device,
                path: currentPath
            });
            
            // Check for child endpoints (aggregator pattern)
            if (device.childEndpoints && Array.isArray(device.childEndpoints)) {
                traverseDevices(device.childEndpoints, currentPath + '/');
            }
        }
    }
    
    try {
        const devices = node.getDevices();
        traverseDevices(devices);
    } catch (error) {
        console.warn('Failed to traverse devices:', error);
    }
    
    return allDevices;
}

/**
 * Find a device by endpoint ID, supporting nested child endpoints
 */
export function findDeviceByEndpoint(node: any, targetEndpointId: number): any | null {
    const allDevices = findAllDevices(node);
    const found = allDevices.find(item => item.endpoint === targetEndpointId);
    return found ? found.device : null;
}

/**
 * Check if a device is a bridge/aggregator device
 */
export function isBridgeDevice(device: any): boolean {
    try {
        // Check device type for aggregator pattern
        const deviceType = device.deviceType;
        
        // Common aggregator device types
        const aggregatorTypes = [
            0x000E, // Aggregator
            0x0013, // Bridge
        ];
        
        if (aggregatorTypes.includes(deviceType)) {
            return true;
        }
        
        // Check if device has child endpoints
        return device.childEndpoints && Array.isArray(device.childEndpoints) && device.childEndpoints.length > 0;
    } catch (error) {
        return false;
    }
}