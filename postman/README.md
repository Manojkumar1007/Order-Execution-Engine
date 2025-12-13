# Postman Collection

This directory contains the Postman collection for the Solana Order Execution Engine API.

## File
`postman_collection.json`: Importable collection format v2.1.

## How to Import
1. Open Postman or Insomnia.
2. Click **Import**.
3. Drag and drop `postman_collection.json` or browse to select it.
4. The collection "Solana Order Execution Engine" will be created.

## Configuration
- **Base URL**: The collection uses `{{baseUrl}}` variable which defaults to `http://localhost:3000`. You can change this in the collection variables if your server is running on a different port.

## Walkthrough Verification
To follow the project walkthrough:
1. Start the server: `npm run dev`
2. Use the **Health Check** request to verify connectivity.
3. Submit an order using **Execute Order**.
4. Check the order status using **Get Order Details**.
5. View system load using **Get Queue Metrics**.
