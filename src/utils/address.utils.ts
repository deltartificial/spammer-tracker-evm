export function extractAddressesFromData(data: string): string[] {
  const addresses: string[] = [];
  const cleanData = data.slice(10);

  for (let i = 0; i < cleanData.length; i += 64) {
    const word = cleanData.slice(i, i + 64);
    const potentialAddress = "0x" + word.slice(24);

    if (
      /^0x[a-fA-F0-9]{40}$/.test(potentialAddress) &&
      potentialAddress !== "0x0000000000000000000000000000000000000000"
    ) {
      addresses.push(potentialAddress.toLowerCase());
    }
  }

  return [...new Set(addresses)];
}
