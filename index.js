const ethers = require("ethers");
const FACTORY_ABI = require("./abis/factory.json");
const SWAP_ROUTER_ABI = require("./abis/swaprouter.json");
const POOL_ABI = require("./abis/pool.json");
const TOKEN_IN_ABI = require("./abis/token.json");
const CTOKEN_ABI = require("./abis/cToken.json");
const dotenv = require("dotenv");
dotenv.config();

const POOL_FACTORY_CONTRACT_ADDRESS = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const SWAP_ROUTER_CONTRACT_ADDRESS = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const COMPOUND_CDAI_ADDRESS = "0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643"; // cDAI contract address

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const factoryContract = new ethers.Contract(POOL_FACTORY_CONTRACT_ADDRESS, FACTORY_ABI, provider);
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const USDC = {
  chainId: 11155111,
  address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  decimals: 6,
  symbol: "USDC",
  name: "USD//C",
  isToken: true,
  isNative: true,
  wrapped: false,
};

const LINK = {
  chainId: 11155111,
  address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
  decimals: 18,
  symbol: "LINK",
  name: "Chainlink",
  isToken: true,
  isNative: true,
  wrapped: false,
};

// Part A - Approve Token Function
async function approveToken(tokenAddress, tokenABI, amount, wallet) {
  try {
    const tokenContract = new ethers.Contract(tokenAddress, tokenABI, wallet);
    const approveAmount = ethers.parseUnits(amount.toString(), USDC.decimals);
    const approveTransaction = await tokenContract.approve.populateTransaction(SWAP_ROUTER_CONTRACT_ADDRESS, approveAmount);
    const transactionResponse = await wallet.sendTransaction(approveTransaction);
    console.log(`Transaction Sent: ${transactionResponse.hash}`);
    const receipt = await transactionResponse.wait();
    console.log(`Approval Transaction Confirmed! https://sepolia.etherscan.io/tx/${receipt.hash}`);
  } catch (error) {
    console.error("An error occurred during token approval:", error);
    throw new Error("Token approval failed");
  }
}

// Part B - Get Pool Info Function
async function getPoolInfo(factoryContract, tokenIn, tokenOut) {
  const poolAddress = await factoryContract.getPool(tokenIn.address, tokenOut.address, 3000);
  if (!poolAddress) {
    throw new Error("Failed to get pool address");
  }
  const poolContract = new ethers.Contract(poolAddress, POOL_ABI, provider);
  const [token0, token1, fee] = await Promise.all([poolContract.token0(), poolContract.token1(), poolContract.fee()]);
  return { poolContract, token0, token1, fee };
}

// Part C - Prepare Swap Params Function
async function prepareSwapParams(poolContract, signer, amountIn) {
  return {
    tokenIn: USDC.address,
    tokenOut: LINK.address,
    fee: await poolContract.fee(),
    recipient: signer.address,
    amountIn: amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0,
  };
}

// Part D - Execute Swap Function
async function executeSwap(swapRouter, params, signer) {
  const transaction = await swapRouter.exactInputSingle.populateTransaction(params);
  const receipt = await signer.sendTransaction(transaction);
  console.log(`Transaction Hash: https://sepolia.etherscan.io/tx/${receipt.hash}`);
}

// Part E - Supply to Compound Function
async function supplyToCompound(tokenAddress, amount, signer) {
  try {
    // Step 1: Approve Compound to spend your tokens
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_IN_ABI, signer);
    const approveTransaction = await tokenContract.approve.populateTransaction(COMPOUND_CDAI_ADDRESS, amount);
    const approvalResponse = await signer.sendTransaction(approveTransaction);
    await approvalResponse.wait();

    // Step 2: Supply tokens to Compound
    const cToken = new ethers.Contract(COMPOUND_CDAI_ADDRESS, CTOKEN_ABI, signer);
    const supplyTransaction = await cToken.mint(amount);
    const supplyResponse = await supplyTransaction.wait();

    console.log(`Successfully supplied ${ethers.formatUnits(amount, LINK.decimals)} LINK to Compound.`);
    console.log(`Transaction Hash: https://sepolia.etherscan.io/tx/${supplyResponse.transactionHash}`);
  } catch (error) {
    console.error("An error occurred while supplying tokens to Compound:", error.message);
    throw new Error("Compound supply failed");
  }
}

// Part F - Main Function
async function main(swapAmount) {
  const inputAmount = swapAmount;
  const amountIn = ethers.parseUnits(inputAmount.toString(), USDC.decimals);

  try {
    await approveToken(USDC.address, TOKEN_IN_ABI, inputAmount, signer);
    const { poolContract } = await getPoolInfo(factoryContract, USDC, LINK);
    const params = await prepareSwapParams(poolContract, signer, amountIn);
    const swapRouter = new ethers.Contract(SWAP_ROUTER_CONTRACT_ADDRESS, SWAP_ROUTER_ABI, signer);
    await executeSwap(swapRouter, params, signer);

    // After successful swap, supply the LINK to Compound
    const amountOut = params.amountIn; // Assuming swap returns 1:1 for simplicity
    await supplyToCompound(LINK.address, amountOut, signer);
  } catch (error) {
    console.error("An error occurred:", error.message);
  }
}

// Enter Swap Amount
main(1);
