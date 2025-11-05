// SPDX-License-Identifier: MIT
// This script executes a full lifecycle test for the SecondPriceAuction system.
// It includes deployment of the required NFT contract, the auction factory,
// auction creation with parameter checks, and the commit/reveal bidding phases.

// Helper function to pause execution for timing-dependent tests
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Logs the gas used for a transaction receipt.
 * @param {object} receipt - The transaction receipt.
 * @param {string} action - Description of the action performed.
 */
function logGasUsed(receipt, action) {
    if (receipt && receipt.gasUsed) {
        console.log(`\t[GAS USED] ${action}: ${receipt.gasUsed.toLocaleString('en-US')}`);
    } else {
        console.log(`\t[GAS USED] ${action}: Not available`);
    }
}

// ====== Helper: Get first n accounts (Seller and Bidders) ======
async function getAccounts(n) {
    const accounts = await web3.eth.getAccounts();
    if (n <= 0) throw new Error("Number of accounts must be greater than 0");
    // Ensure we don't request more accounts than available
    if (n > accounts.length) n = accounts.length; 
    return accounts.slice(0, n);
}

// ====== Helper: Print balances of participating accounts ======
async function printBalances(accounts, title = "Account Balances") {
    console.log(`\n=== ${title} ===`);
    for (let i = 0; i < accounts.length; i++) {
        const balanceWei = await web3.eth.getBalance(accounts[i]);
        // Use fromWei to display balances in a readable format (ETH)
        const balanceEth = web3.utils.fromWei(balanceWei, "ether"); 
        // Use a consistent label (Seller, Bidder 0, Bidder 1) for clarity
        const label = i === 0 ? "Seller" : `Bidder ${i - 1}`;
        console.log(`${label} (${accounts[i].substring(0, 10)}...): ${balanceEth} ETH`);
    }
    console.log("========================\n");
}

// ====== Mint NFT using ClassNFT contract ======
async function mintNFT(deployer, uri) {
    console.log("=== Minting NFT (Dependency Deployment) ===");

    // Load ClassNFT artifact from the Remix artifacts folder
    const ClassNFTArtifact = await remix.call("fileManager", "getFile", "browser/artifacts/ClassNFT.json");
    const json = JSON.parse(ClassNFTArtifact);
    const abi = json.abi;
    const bytecode = json.data?.bytecode?.object || json.bytecode?.object;

    const ClassNFT = new web3.eth.Contract(abi);

    // Deploy NFT Contract
    const gasEstimateDeploy = await ClassNFT.deploy({ data: bytecode }).estimateGas({ from: deployer });
    const deployReceipt = await ClassNFT.deploy({ data: bytecode })
        .send({ from: deployer, gas: gasEstimateDeploy + 100000 });
    
    logGasUsed(deployReceipt, "ClassNFT Deployment");
    
    // Get contract instance from the receipt's address
    const contract = new web3.eth.Contract(abi, deployReceipt.options.address);
    console.log("ClassNFT deployed at:", contract.options.address);

    // Mint NFT to the deployer (seller)
    const receipt = await contract.methods.safeMint(uri)
        .send({ from: deployer, gas: 300000 });

    logGasUsed(receipt, "ClassNFT safeMint");
    
    // Extract tokenId from the emitted Transfer event
    const tokenId = receipt.events.Transfer.returnValues.tokenId;
    console.log(`NFT minted, tokenId: ${tokenId}, URI: ${uri}`);
    console.log("==================================\n");

    // Return the instance, address, and tokenId
    return { nftContractInstance: contract, contractAddress: contract.options.address, tokenId };
}

// ====== Post NFT to Auction Contract ======
async function postNFTToAuction(nftContractInstance, sellerAddress, auctionAddress, tokenId) {
    console.log("=== Posting NFT to Auction Contract ===");
    console.log(`Transferring NFT ID ${tokenId} from Seller to Auction: ${auctionAddress}`);
    
    // The seller calls safeTransferFrom on the NFT contract to transfer ownership to the Auction contract.
    const receipt = await nftContractInstance.methods.safeTransferFrom(
        sellerAddress, 
        auctionAddress, 
        tokenId
    ).send({ from: sellerAddress, gas: 300000 });
    
    logGasUsed(receipt, "NFT safeTransferFrom to Auction");
    
    console.log("NFT successfully transferred to the Auction contract.");
    console.log("==================================================\n");
}


// ====== Deploy SecondPriceAuction Factory and Create Auction Instance ======
async function deploySecondPriceAuction(deployer, params) {
    console.log("=== Deploying SecondPriceAuction Factory & Auction Instance ===");

    // 1. Deploy Factory
    const factoryArtifact = await remix.call("fileManager", "getFile", "browser/artifacts/SecondPriceAuctionFactory.json");
    const factoryJson = JSON.parse(factoryArtifact);
    const factoryAbi = factoryJson.abi;
    const factoryBytecode = factoryJson.data?.bytecode?.object || factoryJson.bytecode?.object;

    const factoryContract = new web3.eth.Contract(factoryAbi);

    const gasEstimateFactory = await factoryContract.deploy({ data: factoryBytecode }).estimateGas({ from: deployer });
    const deployedFactoryReceipt = await factoryContract.deploy({ data: factoryBytecode })
        .send({ from: deployer, gas: gasEstimateFactory + 100000 });
    
    logGasUsed(deployedFactoryReceipt, "Factory Deployment");
    const deployedFactory = new web3.eth.Contract(factoryAbi, deployedFactoryReceipt.options.address);

    console.log("Factory deployed at:", deployedFactory.options.address);

    // 2. Call createAuction
    // Calculate the total ETH value required to be sent upfront for all fees
    const totalValue = web3.utils.toBN(params.commitRevealTransitionFee)
        .add(web3.utils.toBN(params.revealEndTransitionFee))
        .add(web3.utils.toBN(params.noPostingFee));

    const gasEstimateAuction = await deployedFactory.methods.createAuction(
        params.reservePrice,
        params.auctionRevealTime,
        params.auctionEndTime,
        params.commitRevealTransitionFee,
        params.revealEndTransitionFee,
        params.noPostingFee,
        params.itemContractAddress
    ).estimateGas({ from: deployer, value: totalValue.toString() });

    const txReceipt = await deployedFactory.methods.createAuction(
        params.reservePrice,
        params.auctionRevealTime,
        params.auctionEndTime,
        params.commitRevealTransitionFee,
        params.revealEndTransitionFee,
        params.noPostingFee,
        params.itemContractAddress
    ).send({ from: deployer, gas: gasEstimateAuction + 100000, value: totalValue.toString() });

    logGasUsed(txReceipt, "Factory createAuction");

    // 3. Extract Auction Address
    const auctionEvent = txReceipt.events?.AuctionCreated;
    if (!auctionEvent) {
        throw new Error("AuctionCreated event not found. Check factory creation function.");
    }
    const auctionAddress = auctionEvent.returnValues.auctionAddress;
    console.log("SecondPriceAuction deployed at:", auctionAddress);

    // 4. Return Web3 contract instance
    const auctionArtifact = await remix.call("fileManager", "getFile", "browser/artifacts/SecondPriceAuction.json");
    const auctionJson = JSON.parse(auctionArtifact);
    const auctionAbi = auctionJson.abi;
    const auctionContract = new web3.eth.Contract(auctionAbi, auctionAddress);

    console.log("========================================================\n");
    return auctionContract;
}

// ====== Build auction parameters, converting ETH values to Wei and times to Unix timestamps ======
async function getParams(reserveEther, secs_till_reveal, secs_till_end, commitRevealFeeEther, revealEndFeeEther, noPostEther, contractAddress) {
    const now = Math.floor(Date.now() / 1000);
    return {
        // Convert all ETH amounts to Wei for contract use
        reservePrice: web3.utils.toWei(reserveEther, "ether"),
        // Calculate future timestamps
        auctionRevealTime: now + secs_till_reveal,
        auctionEndTime: now + secs_till_end, 
        commitRevealTransitionFee: web3.utils.toWei(commitRevealFeeEther, "ether"),
        revealEndTransitionFee: web3.utils.toWei(revealEndFeeEther, "ether"),
        noPostingFee: web3.utils.toWei(noPostEther, "ether"),
        itemContractAddress: contractAddress
    };
}

// ====== Place Bid (Commit Stage) ======
async function testBid(auction, bidder, bidamount, reserveEther, bidderLabel) {
    console.log(`\n=== ${bidderLabel} Commits Bid ===`);
    
    // Convert the user's intended bid amount and the required reserve price to Wei
    const bidWei = web3.utils.toWei(bidamount, "ether");
    const reserveWei = web3.utils.toWei(reserveEther, "ether");
    
    // Generate a random salt for privacy
    const salt = web3.utils.randomHex(32); 

    // Hash the (bid amount in Wei + salt) for the commitment
    const saltedHash = web3.utils.soliditySha3(
        { type: "uint256", value: bidWei },
        { type: "bytes32", value: salt }
    );

    const receipt = await auction.methods.placeBid(saltedHash)
        // Only send the reserve price up front
        .send({ from: bidder, value: reserveWei }); 
    
    logGasUsed(receipt, `placeBid (Commit for ${bidamount} ETH)`);
    
    console.log(`Committed hash: ${saltedHash.substring(0, 10)}... Reserve paid: ${reserveEther} ETH.`);
    console.log("==================================\n");
    
    // Return the actual bid and salt for the later reveal phase
    return { bid: bidWei, salt }; 
}

// ====== Reveal Bid (Reveal Stage) ======
async function testReveal(auction, bidder, bid, salt, bidamountEth, bidderLabel) {
    console.log(`\n=== ${bidderLabel} Reveals Bid ===`);
    
    // The value sent must match the actual bid amount being revealed
    const weiValue = bid; 
    
    const receipt = await auction.methods.revealBid(bid, salt)
        .send({ from: bidder, value: weiValue });
        
    logGasUsed(receipt, `revealBid (${bidamountEth} ETH)`);
    
    console.log(`Revealed bid: ${bidamountEth} ETH.`);
    console.log("==================================\n");
}

// ====== Script Configuration Constants ======
const NUM_BIDDERS = 2;
const NFT_URI = "https://raw.githubusercontent.com/kailen-hargenrader/Ethereum_SPA/refs/heads/main/NFT_metadata.json";
const RESERVE_PRICE = "1.0"; // 1.0 ETH
const SECONDS_TILL_REVEAL = 5;
const SECONDS_TILL_END = 10;
const COMMIT_REVEAL_TRANSITION_FEE = "0.01";
const REVEAL_TO_END_TRANSITION_FEE = "0.01";
const FAILURE_TO_POST_FEE = "0.01";

// ====== Main Execution Script ======
async function main() {
    let accounts, seller, bidder0, bidder1, contractAddress, tokenId, auction, bid0, salt0, bid1, salt1;
    let params;
    let nftContractInstance; 
    
    try {
        // Setup Accounts and Balances
        accounts = await getAccounts(NUM_BIDDERS + 1);
        seller = accounts[0];
        bidder0 = accounts[1];
        bidder1 = accounts[2];

        console.log("Initial Setup");
        await printBalances(accounts, "Initial Balances");
        
        // Deploy NFT and Mint Token
        ({ nftContractInstance, contractAddress, tokenId } = await mintNFT(seller, NFT_URI));

        // Build Auction Parameters
        params = await getParams(
            RESERVE_PRICE, SECONDS_TILL_REVEAL, SECONDS_TILL_END,
            COMMIT_REVEAL_TRANSITION_FEE, REVEAL_TO_END_TRANSITION_FEE, FAILURE_TO_POST_FEE, contractAddress
        );
        
        // --- TEST 1: SUCCESSFUL AUCTION DEPLOYMENT ---
        auction = await deploySecondPriceAuction(seller, params);
        console.log("✅ Auction with valid parameters succeeds as expected.");
    
        await printBalances(accounts, "Balances after Deployments");
        
        // --- NFT POSTING ---
        await postNFTToAuction(nftContractInstance, seller, auction.options.address, tokenId);
        console.log("NFT is now officially owned by the auction contract.");
        
        await printBalances(accounts, "Balances after NFT Posting");
        
        // --- TEST 2: SUCCESSFUL BIDDING (COMMIT STAGE) ---
        
        // Bidder 0 commits 1.0 ETH bid (with 1.0 ETH reserve) - Second-highest bid
        ({ bid: bid0, salt: salt0 } = await testBid(auction, bidder0, "1.0", RESERVE_PRICE, "Bidder 0"));
        console.log("✅ Bidder 0 committed bid successfully.");
        
        // Bidder 1 commits 3.0 ETH bid (with 1.0 ETH reserve) - Highest bid
        ({ bid: bid1, salt: salt1 } = await testBid(auction, bidder1, "3.0", RESERVE_PRICE, "Bidder 1"));
        console.log("✅ Bidder 1 committed bid successfully.");
        
        await printBalances(accounts, "Balances after Commitment (Reserve prices paid)");

        // --- TEST 3: STAGE TRANSITION TO REVEAL ---
        
        // Advance time and transition to reveal stage
        console.log(`\nWaiting ${SECONDS_TILL_REVEAL} seconds to reach Reveal Time...`);
        await sleep(SECONDS_TILL_REVEAL * 1000); 
        
        const revealReceipt = await auction.methods.transitionToReveal().send({ 
            from: seller
        });
        console.log("=== Transition to reveal ===");
        logGasUsed(revealReceipt, "transitionToReveal");
        
        await printBalances(accounts, "Balances after Reveal Transition");
        
        // --- TEST 4: REVEAL PHASE ---

        // Test 4a: Bidder 0 reveals their 1.0 ETH bid
        await testReveal(auction, bidder0, bid0, salt0, "1.0", "Bidder 0");
        
        // Test 4b: Bidder 1 reveals their 3.0 ETH bid (should become top bid)
        await testReveal(auction, bidder1, bid1, salt1, "3.0", "Bidder 1");
        
        await printBalances(accounts, "Balances after Revealing (Bidder 0 Refunded Reserve)");

        // --- TEST 5: AUCTION END ---
        
        // Advance time past the auction end time
        console.log(`\nWaiting ${SECONDS_TILL_END - SECONDS_TILL_REVEAL} seconds to reach End Time...`);
        await sleep((SECONDS_TILL_END - SECONDS_TILL_REVEAL) * 1000); 

        // End the auction
        const endReceipt = await auction.methods.transitionToEnd().send({ 
            from: seller
        });
        console.log("✅ Transition to end stage succeeds.");
        logGasUsed(endReceipt, "transitionToEnd");
        
        await printBalances(accounts, "Balances after End Transition");

        // --- TEST 6: CLAIM PHASE ---

        try {
            const claimItemReceipt = await auction.methods.getNFT().send({ from: bidder1});
            logGasUsed(claimItemReceipt, "claimItem (Winner/Bidder 1)");
            console.log("✅ Top Bidder (Bidder 1) successfully claimed the NFT and received refund.");
        } catch(err) {
            console.log("❌ CLAIMING NFT FAILED! (Check Second Price logic or Refund)"); 
            console.error("Error Message: ", err.message);
        }
        await printBalances(accounts, "Balances after Winner Claim");
        
        try {
            const claimSellerReceipt = await auction.methods.getRefund().send({ from: seller});
            logGasUsed(claimSellerReceipt, "claimFunds (Seller)");
            console.log("✅ Seller successfully claimed funds.");
        } catch(err) {
            console.log("❌ SELLER CLAIMING FUNDS FAILED.");
            console.error("Error Message: ", err.message);
        }
        await printBalances(accounts, "Balances after Seller Claim");
        
        try {
            const claimRefund0Receipt = await auction.methods.getRefund().send({ from: bidder0});
            logGasUsed(claimRefund0Receipt, "claimRefund (Non-Winner Bidder 0)");
            console.log("✅ Bidder 0 successfully claimed refund.");
        } catch(err) {
            console.log("❌ BIDDER 0 CLAIMING REFUND FAILED.");
            console.error("Error Message: ", err.message);
        }

        try {
            const claimRefund0Receipt = await auction.methods.getRefund().send({ from: bidder1});
            logGasUsed(claimRefund0Receipt, "claimRefund (Winner Bidder 1)");
            console.log("✅ Bidder 1 successfully claimed refund.");
        } catch(err) {
            console.log("❌ BIDDER 1 CLAIMING REFUND FAILED.");
            console.error("Error Message: ", err.message);
        }

        // Final balances check
        await printBalances(accounts, "Final Balances (After Claims)");
        console.log("--- SCRIPT COMPLETE ---");

    } catch(err) {
        console.error("\n*** FATAL SCRIPT ERROR ***:", err.message);
        console.log("--- SCRIPT TERMINATED ---");
    }
}

// ====== Run ======
main();