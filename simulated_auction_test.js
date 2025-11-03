// ====== Helper to get first n accounts ======
async function getAccounts(n) {
    // Use Remix's injected provider
    const provider = new ethers.providers.Web3Provider(web3.currentProvider);

    // Get all available accounts
    const accounts = await provider.listAccounts();

    if (n <= 0) throw new Error("Number of accounts must be greater than 0");
    if (n > accounts.length) n = accounts.length;

    // Convert addresses to signer objects
    const signers = accounts.slice(0, n).map(addr => provider.getSigner(addr));
    return signers;
}

// ====== Helper to print balances ======
async function printBalances(accounts) {
    const provider = new ethers.providers.Web3Provider(web3.currentProvider);

    console.log("=== Account Balances ===");
    for (let i = 0; i < accounts.length; i++) {
        const address = await accounts[i].getAddress();
        const balance = await provider.getBalance(address);
        console.log(`Account ${i} (${address}): ${ethers.utils.formatEther(balance)} ETH`);
    }
    console.log("========================\n");
}

/**
 * Deploys the ClassNFT contract, mints an NFT, and returns contract & NFT info.
 * @param {string} uri - Metadata URI for the NFT.
 * @returns {Promise<{contractAddress: string, tokenId: number}>}
 */
async function mintNFT(deployer, uri) {
    console.log("=== Minting NFT ===");
    // Get accounts from Remix JS VM
    console.log("Deployer account:", deployer._address);

    // Get compiled artifact from Remix
    const ClassNFTArtifact = await remix.call("fileManager", "getFile", "browser/artifacts/ClassNFT.json");
    const ClassNFTJSON = JSON.parse(ClassNFTArtifact);

    
    // ABI
    const abi = ClassNFTJSON.abi;

    // Bytecode
    // Depending on Remix version, use one of these:
    const bytecode = ClassNFTJSON.data?.bytecode?.object || ClassNFTJSON.bytecode?.object;

    // Deploy the contract
    const contractInstance = new web3.eth.Contract(abi);
    const deployed = await contractInstance.deploy({ data: bytecode }).send({ from: deployer._address, gas: 5000000 });

    console.log("ClassNFT deployed at:", deployed.options.address);

    // Mint the NFT
    const receipt = await deployed.methods.safeMint(uri).send({ from: deployer._address });

    // Get tokenId from event
    const event = receipt.events.Minted;
    const mintedTokenId = event.returnValues.tokenId; 

    console.log(`NFT minted, tokenId: ${mintedTokenId}, URI: ${uri}`);
    console.log("========================\n");
    return {
        contractAddress: deployed.options.address,
        tokenId: mintedTokenId
    };
}

/**
 * Deploys the SecondPriceAuction contract with specified parameters.
 * 
 * @param {ethers.Signer} deployer - The signer that will deploy the contract
 * @param {Object} params - Constructor parameters
 * @param {number|string} params.reservePrice - Minimum reserve price (in wei)
 * @param {number|string} params.auctionRevealTime - Timestamp when commit stage ends
 * @param {number|string} params.auctionEndTime - Timestamp when reveal stage ends
 * @param {number|string} params.commitRevealTransitionFee - Fee for switching to reveal stage (in wei)
 * @param {number|string} params.revealEndTransitionFee - Fee for switching to end stage (in wei)
 * @param {number|string} params.noPostingFee - Fee for posting NFT (in wei)
 * @param {string} params.itemContractAddress - Address of the ERC721 contract of the NFT
 * @returns {Promise<ethers.Contract>} The deployed contract instance
 */
async function deploySecondPriceAuction(deployer, params) {
    console.log("=== Deploy SPA ===");

    // Load the artifact from Remix
    // Replace "SecondPriceAuction" with the contract name in Remix's compilation details
    const artifact = await remix.call("fileManager", "getFile", "browser/artifacts/SecondPriceAuction.json");
    const json = JSON.parse(artifact);
    const abi = json.abi;
    const bytecode = json.data.bytecode.object;

    // Create ContractFactory
    const factory = new ethers.ContractFactory(abi, bytecode, deployer);

    // Compute total fees
    const totalValue = ethers.BigNumber.from(params.commitRevealTransitionFee)
        .add(params.revealEndTransitionFee)
        .add(params.noPostingFee);

    // Deploy contract
    const contract = await factory.deploy(
        params.reservePrice,
        params.auctionRevealTime,
        params.auctionEndTime,
        params.commitRevealTransitionFee,
        params.revealEndTransitionFee,
        params.noPostingFee,
        params.itemContractAddress,
        { value: totalValue }
    );
    await contract.deployed();
    console.log("SecondPriceAuction deployed at:", contract.address);
    console.log("========================\n");
    return contract;
}

async function getParams(reserveEther, secs_till_reveal, secs_till_end, commitRevealFeeEther, revealEndFeeEther, noPostEther, contractAddress) {
    const params = {
            reservePrice: ethers.utils.parseEther(reserveEther),          // 1 ETH
            auctionRevealTime: Math.floor(Date.now() / 1000) + secs_till_reveal, // 1 minute from now
            auctionEndTime: Math.floor(Date.now() / 1000) + secs_till_end,  // 1 hour from now
            commitRevealTransitionFee: ethers.utils.parseEther(commitRevealFeeEther),
            revealEndTransitionFee: ethers.utils.parseEther(revealEndFeeEther),
            noPostingFee: ethers.utils.parseEther(noPostEther),
            itemContractAddress: contractAddress
        };
    return params;
}

async function testBid(auction, bidder, bidamount, value, gas) {
    console.log("=== Place Bid ===");
    console.log("Bidder: ", bidder._address);
    // Generate a random salt
    const salt = web3.utils.randomHex(32); // 32 bytes
    // Convert Ether to uint256
    const message = web3.utils.toWei(bidamount, "ether");
    const val = web3.utils.toWei(value, "ether");
    // Compute a salted hash
    const saltedHash = web3.utils.soliditySha3(
    { type: "uint256", value: message },
    { type: "bytes32", value: salt },
    );
    const auctionWithBidder = auction.connect(bidder);
    const tx = await auctionWithBidder.placeBid(saltedHash, {gasLimit: gas, value: val});
    const receipt = await tx.wait();
    console.log("Transaction hash:", receipt.transactionHash);
    console.log("Gas used:", receipt.gasUsed.toNumber());
    console.log("========================\n");
}

NUM_BIDDERS = 1;
NFT_URI = "https://raw.githubusercontent.com/kailen-hargenrader/Ethereum_SPA/refs/heads/main/NFT_metadata.json";
RESERVE_PRICE = "1.0";
SECONDS_TILL_REVEAL = 60;
SECONDS_TILL_END = 120;
COMMIT_REVEAL_TRANSITION_FEE = "0.01";
REVEAL_TO_END_TRANSITION_FEE = "0.01";
FAILURE_TO_POST_FEE = "0.01";

// ====== Main script ======
async function main() {
    try {
        const accounts = await getAccounts(NUM_BIDDERS + 1);
        const seller = accounts[0];
        const bidders = accounts.slice(1, NUM_BIDDERS + 1);

        // Print initial balances
        console.log("Initial balances:");
        await printBalances(accounts);

        //mint NFT
        const { contractAddress, tokenId } = await mintNFT(seller, NFT_URI);
        const params = await getParams(
            RESERVE_PRICE, 
            SECONDS_TILL_REVEAL, 
            SECONDS_TILL_END, 
            COMMIT_REVEAL_TRANSITION_FEE, 
            REVEAL_TO_END_TRANSITION_FEE,
            FAILURE_TO_POST_FEE, 
            contractAddress);
        
        // make auction
        const auction = await deploySecondPriceAuction(seller, params);
        await printBalances(bidders);
        await testBid(auction, bidders[0], "2.0", RESERVE_PRICE, 500000);
        await printBalances(bidders);

    } catch (err) {
        console.error(err);
    }
}

// ====== Run the script ======
main();