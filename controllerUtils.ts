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
 * @returns A formatted string representation of the node structure
 * 
 * Usage examples:
 * - const plainStructure = getNodeStructureString(node);
 * - const coloredStructure = getNodeStructureString(node, 'ansi');
 */
export function getNodeStructureInfo(node: any, format: 'plain' | 'ansi' = 'plain'): string {
    // Choose formatter based on the format parameter
    const formatter = format === 'ansi' ? LogFormat.formats.ansi : LogFormat.formats.plain;
    
    // Get the diagnostic value from the node (this is what logStructure() uses internally)
    const diagnosticValue = node[Diagnostic.value];
    
    // Format it as a string with no indentation
    return formatter(diagnosticValue, 0);
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