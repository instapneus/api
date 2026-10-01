function formatAddress(address) {
  if (!address) {
    return null;
  }

  // Already formatted
  if (typeof address === "string") {
    return address;
  }

  // Address object
  return [address.civicNumber, address.street, address.city, address.postalCode]
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  formatAddress,
};
