import { getAddress, isAddress, type Address, type Hex } from "viem";

export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function envPrefix(networkName: string) {
  return networkName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
}

export function networkEnv(prefix: string, name: string): string | undefined {
  return optionalEnv(`${prefix}_${name}`) ?? optionalEnv(name);
}

export function requiredNetworkEnv(prefix: string, name: string): string {
  const value = networkEnv(prefix, name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${prefix}_${name} or ${name}`);
  }

  return value;
}

export function requiredAddress(name: string): Address {
  const value = requiredEnv(name);
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

export function optionalAddress(name: string): Address | undefined {
  const value = optionalEnv(name);
  if (value === undefined) {
    return undefined;
  }
  if (!isAddress(value)) {
    throw new Error(`${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

export function requiredNetworkAddress(prefix: string, name: string): Address {
  const value = requiredNetworkEnv(prefix, name);
  if (!isAddress(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

export function optionalNetworkAddress(prefix: string, name: string): Address | undefined {
  const value = networkEnv(prefix, name);
  if (value === undefined) {
    return undefined;
  }
  if (!isAddress(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a valid 0x address`);
  }

  return getAddress(value);
}

export function requiredPrivateKey(name: string): Hex {
  const value = requiredEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte private key with 0x prefix`);
  }

  return value as Hex;
}

export function requiredBigInt(name: string): bigint {
  const value = requiredEnv(name);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer string`);
  }

  return BigInt(value);
}

export function requiredNetworkBigInt(prefix: string, name: string): bigint {
  const value = requiredNetworkEnv(prefix, name);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a non-negative integer string`);
  }

  return BigInt(value);
}

export function requiredNetworkBigIntList(prefix: string, name: string): bigint[] {
  const value = requiredNetworkEnv(prefix, name);
  const amounts = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (amounts.length === 0) {
    throw new Error(`${prefix}_${name} or ${name} must contain at least one non-negative integer string`);
  }

  return amounts.map((amount) => {
    if (!/^\d+$/.test(amount)) {
      throw new Error(`${prefix}_${name} or ${name} contains an invalid non-negative integer string: ${amount}`);
    }

    return BigInt(amount);
  });
}

export function requiredPositiveSeconds(name: string): bigint {
  const value = requiredBigInt(name);
  if (value === 0n) {
    throw new Error(`${name} must be greater than 0`);
  }

  return value;
}

export function requiredNetworkPrivateKey(prefix: string, name: string): Hex {
  const value = requiredNetworkEnv(prefix, name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${prefix}_${name} or ${name} must be a 32-byte private key with 0x prefix`);
  }

  return value as Hex;
}

export function requiredNetworkPositiveSeconds(prefix: string, name: string): bigint {
  const value = requiredNetworkBigInt(prefix, name);
  if (value === 0n) {
    throw new Error(`${prefix}_${name} or ${name} must be greater than 0`);
  }

  return value;
}

export function requiredNetworkAddressList(prefix: string, name: string): Address[] {
  const value = requiredNetworkEnv(prefix, name);
  const addresses = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (addresses.length === 0) {
    throw new Error(`${prefix}_${name} or ${name} must contain at least one 0x address`);
  }

  return addresses.map((address) => {
    if (!isAddress(address)) {
      throw new Error(`${prefix}_${name} or ${name} contains an invalid 0x address: ${address}`);
    }

    return getAddress(address);
  });
}

export function assertExpectedAddress(name: string, actual: Address, expected?: Address) {
  if (expected !== undefined && getAddress(actual) !== getAddress(expected)) {
    throw new Error(`${name} mismatch: private key derives ${actual}, env has ${expected}`);
  }
}
