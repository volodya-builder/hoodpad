/** Minimal config: we only use `hardhat node` as a local EVM.
 *  Compilation is done separately via scripts/compile.js (solc-js). */
module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat: {
      chainId: 31337,
    },
  },
};
