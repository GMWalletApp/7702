import "dotenv/config";

import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    ethereum: {
      type: "http",
      chainType: "l1",
      chainId: 1,
      url: configVariable("ETHEREUM_RPC_URL"),
      accounts: [configVariable("ETHEREUM_PRIVATE_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "generic",
      chainId: 56,
      url: configVariable("BSC_RPC_URL"),
      accounts: [configVariable("BSC_PRIVATE_KEY")],
    },
    bscTestnet: {
      type: "http",
      chainType: "generic",
      chainId: 97,
      url: configVariable("BSC_TESTNET_RPC_URL"),
      accounts: [configVariable("BSC_TESTNET_PRIVATE_KEY")],
    },
    arbitrumOne: {
      type: "http",
      chainType: "generic",
      chainId: 42161,
      url: configVariable("ARBITRUM_ONE_RPC_URL"),
      accounts: [configVariable("ARBITRUM_ONE_PRIVATE_KEY")],
    },
    polygon: {
      type: "http",
      chainType: "generic",
      chainId: 137,
      url: configVariable("POLYGON_RPC_URL"),
      // The self-relayer payment path creates explicit user/sponsor clients
      // and must not need the Registry owner key. Deployment and owner-only
      // operations still require POLYGON_PRIVATE_KEY and fail without a
      // configured Hardhat wallet.
      accounts: process.env.POLYGON_PRIVATE_KEY?.trim()
        ? [configVariable("POLYGON_PRIVATE_KEY")]
        : [],
    },
    base: {
      type: "http",
      chainType: "op",
      chainId: 8453,
      url: configVariable("BASE_RPC_URL"),
      accounts: [configVariable("BASE_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("BASE_SEPOLIA_PRIVATE_KEY")],
    },
  },
});
