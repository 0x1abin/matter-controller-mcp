# Matter Controller MCP Server

A powerful Model Context Protocol (MCP) server that provides comprehensive Matter device control capabilities. This server enables AI assistants and applications to discover, commission, and control Matter-compatible smart home devices through a standardized interface.

[![npm version](https://badge.fury.io/js/matter-controller-mcp.svg)](https://badge.fury.io/js/matter-controller-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/matter-controller-mcp.svg)](https://nodejs.org/)

## Features

- **🔌 Device Management**: Commission and decommission Matter devices with automatic connection
- **💡 Device Control**: Control lights, switches, and other Matter devices
- **🎛️ Advanced Controls**: Support for dimming, color control, and color temperature
- **📊 Device Information**: Retrieve detailed device information and capabilities structure
- **🔧 Attribute Access**: Read and write device cluster attributes directly
- **🌐 Multiple Transports**: Support for stdio, SSE, and streamable HTTP transports
- **🔧 Flexible Configuration**: Environment-based configuration options

## Supported Device Types

- **Lighting**: On/off lights, dimmable lights, color lights
- **Switches**: Smart switches and outlets
- **Sensors**: Various sensor types (temperature, humidity, etc.)
- **And more**: Any Matter-compatible device

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │◄──►│  MCP Server      │◄──►│  Matter Network │
│  (AI Assistant) │    │  (This Project)  │    │    (Devices)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

The server acts as a bridge between MCP clients and Matter devices, providing a standardized interface for device control and monitoring.

## Installation

### NPM Package

```bash
npm install -g matter-controller-mcp
```

### From Source

```bash
git clone https://github.com/0x1abin/matter-controller-mcp.git
cd matter-controller-mcp
npm install
npm run build
```

## Usage

### As MCP Server (Default - stdio transport)

```bash
npx matter-controller-mcp
# or
matter-controller-mcp
```

### SSE Transport

```bash
npx matter-controller-mcp sse
# or
matter-controller-mcp sse
```

### Streamable HTTP Transport

```bash
npx matter-controller-mcp streamableHttp
# or
matter-controller-mcp streamableHttp
```

### Cursor MCP Server

```json
{
  "mcpServers": {
    "matter-controller": {
      "command": "npx",
      "args": ["-y", "matter-controller-mcp", "stdio"]
    }
  }
}
```

## Configuration

The server supports various environment variables for configuration:

```bash
# Matter controller configuration
export MATTER_UNIQUE_ID="your-unique-controller-id"          # Controller unique identifier
export MATTER_ADMIN_FABRIC_LABEL="Your Matter Controller"    # Admin fabric label  
export MATTER_LOG_LEVEL="info"                               # Log level: debug, info, warn, error

# BLE support (optional)
export ble="true"        # Enable BLE support
export ble.hci.id="0"    # BLE HCI interface ID

# Server configuration
export PORT="3001"       # Port for HTTP/SSE transports
```

## Available Tools

### Device Management

- **`get_controller_status`**: Get current controller status
- **`commission_device`**: Commission a new Matter device
- **`get_commissioned_devices`**: List all commissioned devices
- **`decommission_device`**: Remove a device from the network
- **`get_device_info`**: Get detailed device information

### Device Control

- **`control_onoff_device`**: Turn devices on/off or toggle
- **`control_level_device`**: Control brightness/dimming (0-254)
- **`control_color_device`**: Control color temperature and hue/saturation

### Advanced Features

- **`read_attributes`**: Read device attributes from clusters (specific attributes or all)
- **`write_attributes`**: Write attributes to device clusters (supports batch writing)

## API Examples

### Commission a Device

```typescript
// Using manual pairing code
{
  "name": "commission_device",
  "arguments": {
    "pairingCode": "34970112332"
  }
}

// Using IP address and setup PIN
{
  "name": "commission_device",
  "arguments": {
    "ip": "192.168.1.100",
    "port": 5540,
    "setupPin": 20202021
  }
}

// Using BLE commissioning with WiFi credentials
{
  "name": "commission_device",
  "arguments": {
    "ble": true,
    "setupPin": 20202021,
    "longDiscriminator": 3840,
    "wifiSsid": "YourWiFiNetwork",
    "wifiCredentials": "YourWiFiPassword"
  }
}
```

### Control Device

```typescript
// Turn on a light
{
  "name": "control_onoff_device",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "action": "on"
  }
}

// Set brightness
{
  "name": "control_level_device",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "level": 128
  }
}

// Set color temperature (warm/cool white)
{
  "name": "control_color_device",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "colorTemperature": 250
  }
}

// Set color (hue and saturation for colored lights)
{
  "name": "control_color_device",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "hue": 120,
    "saturation": 200
  }
}
```

### Read Device Information

```typescript
// Get device details
{
  "name": "get_device_info",
  "arguments": {
    "nodeId": "1234567890abcdef"
  }
}

// Read specific attributes
{
  "name": "read_attributes",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "clusterId": 6,  // OnOff cluster
    "endpointId": 1,
    "attributeIds": [0]  // OnOff attribute
  }
}

// Read all attributes in a cluster
{
  "name": "read_attributes",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "clusterId": 6,  // OnOff cluster
    "endpointId": 1
  }
}

// Write attributes (batch writing supported)
{
  "name": "write_attributes",
  "arguments": {
    "nodeId": "1234567890abcdef",
    "clusterId": 6,  // OnOff cluster
    "endpointId": 1,
    "attributes": {
      "0": true  // Set OnOff attribute to true
    }
  }
}
```

## Development

### Prerequisites

- Node.js 18+ 
- TypeScript 5.6+
- Matter.js compatible system
- BLE support (optional, for BLE commissioning)

### Build

```bash
npm run build                # Build the project (compiles TypeScript)
npm run start                # Start with stdio transport (default)
npm run start:sse            # Start with SSE transport
npm run start:streamableHttp # Start with streamable HTTP transport
```

### Code Style

- Use ES modules with `.js` extension in import paths
- Strictly type all functions and variables with TypeScript
- Follow zod schema patterns for tool input validation
- Prefer async/await over callbacks and Promise chains
- Use descriptive variable names and proper error handling

## Contributing

We welcome contributions! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow the existing code style and patterns
- Add appropriate error handling and logging
- Update documentation for new features
- Test your changes thoroughly
- Follow semantic versioning for releases

## Troubleshooting

### Common Issues

1. **Device not found**: Ensure the device is in pairing mode and on the same network
2. **Connection timeout**: Check network connectivity and device availability  
3. **Permission errors**: Ensure proper permissions for BLE access (if using BLE commissioning)
4. **Port conflicts**: Change the PORT environment variable if using HTTP/SSE transport
5. **Controller initialization failed**: Check Matter.js dependencies and system compatibility
6. **Device commissioning failed**: Verify pairing code/PIN and network connectivity

### Debug Mode

Enable debug logging for troubleshooting:

```bash
export MATTER_LOG_LEVEL="debug"
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


## Acknowledgments

- [Project CHIP](https://github.com/project-chip) - The Matter standard
- [Matter.js](https://github.com/project-chip/matter.js) - The core Matter protocol implementation
- [MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk) - The MCP Typescript SDK
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification

---

Made with ❤️ for the Matter and MCP communities
