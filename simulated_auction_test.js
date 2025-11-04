function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ====== Helper: Get first n accounts ======
async function getAccounts(n) {
    const accounts = await web3.eth.getAccounts();
    if (n <= 0) throw new Error("Number of accounts must be greater than 0");
    if (n > accounts.length) n = accounts.length;
    return accounts.slice(0, n);
}

// ====== Helper: Print balances ======
async function printBalances(accounts) {
    console.log("=== Account Balances ===");
    for (let i = 0; i < accounts.length; i++) {
        const balanceWei = await web3.eth.getBalance(accounts[i]);
        const balanceEth = web3.utils.fromWei(balanceWei, "ether");
        console.log(`Account ${i} (${accounts[i]}): ${balanceEth} ETH`);
    }
    console.log("========================\n");
}

// ====== Mint NFT using ClassNFT contract ======
async function mintNFT(deployer, uri) {
    console.log("=== Minting NFT ===");

    const ClassNFTArtifact = await remix.call("fileManager", "getFile", "browser/artifacts/ClassNFT.json");
    const json = JSON.parse(ClassNFTArtifact);
    const abi = json.abi;
    const bytecode = json.data?.bytecode?.object || json.bytecode?.object;

    const ClassNFT = new web3.eth.Contract(abi);

    // Deploy
    const contract = await ClassNFT.deploy({ data: bytecode })
        .send({ from: deployer, gas: 5000000 });
    console.log("ClassNFT deployed at:", contract.options.address);

    // Mint
    const receipt = await contract.methods.safeMint(uri)
        .send({ from: deployer, gas: 300000 });

    // Get tokenId
    const tokenId = receipt.events.Transfer.returnValues.tokenId;
    console.log(`NFT minted, tokenId: ${tokenId}, URI: ${uri}`);
    console.log("========================\n");

    return { contractAddress: contract.options.address, tokenId };
}

// ====== Deploy SecondPriceAuction ======
async function deploySecondPriceAuction(deployer, params) {
    console.log("=== Deploy SecondPriceAuction ===");

    const artifact = await remix.call("fileManager", "getFile", "browser/artifacts/SecondPriceAuction.json");
    const json = JSON.parse(artifact);
    const abi = json.abi;
    const bytecode = json.data?.bytecode?.object || json.bytecode?.object;

    const contract = new web3.eth.Contract(abi);

    const totalValue = web3.utils.toBN(params.commitRevealTransitionFee)
        .add(web3.utils.toBN(params.revealEndTransitionFee))
        .add(web3.utils.toBN(params.noPostingFee));

    const deployed = await contract.deploy({
        data: bytecode,
        arguments: [
            params.reservePrice,
            params.auctionRevealTime,
            params.auctionEndTime,
            params.commitRevealTransitionFee,
            params.revealEndTransitionFee,
            params.noPostingFee,
            params.itemContractAddress
        ]
    }).send({ from: deployer, gas: 6000000, value: totalValue });

    console.log("SecondPriceAuction deployed at:", deployed.options.address);
    console.log("========================\n");
    return deployed;
}

// ====== Build auction params ======
async function getParams(reserveEther, secs_till_reveal, secs_till_end, commitRevealFeeEther, revealEndFeeEther, noPostEther, contractAddress) {
    const now = Math.floor(Date.now() / 1000);
    return {
        reservePrice: web3.utils.toWei(reserveEther, "ether"),
        auctionRevealTime: now + secs_till_reveal,
        auctionEndTime: now + secs_till_end,
        commitRevealTransitionFee: web3.utils.toWei(commitRevealFeeEther, "ether"),
        revealEndTransitionFee: web3.utils.toWei(revealEndFeeEther, "ether"),
        noPostingFee: web3.utils.toWei(noPostEther, "ether"),
        itemContractAddress: contractAddress
    };
}

// ====== Place Bid ======
async function testBid(auction, bidder, bidamount, ethValue) {
    console.log("=== Place Bid ===");
    console.log("Bidder:", bidder);

    const salt = web3.utils.randomHex(32);
    const message = web3.utils.toWei(bidamount, "ether");
    const val = web3.utils.toWei(ethValue, "ether");

    const saltedHash = web3.utils.soliditySha3(
        { type: "uint256", value: message },
        { type: "bytes32", value: salt }
    );

    const receipt = await auction.methods.placeBid(saltedHash)
        .send({ from: bidder, value: val });
    console.log("Transaction hash:", receipt.transactionHash);
    console.log("Gas used:", receipt.gasUsed);
    console.log("========================\n");
    return { bid: message, salt };
}

// ====== Reveal Bid ======
async function testReveal(auction, bidder, bid, salt, weiValue) {
    console.log("=== Reveal Bid ===");
    console.log("Bidder:", bidder);
    const receipt = await auction.methods.revealBid(bid, salt)
        .send({ from: bidder, value: weiValue });
    console.log("Transaction hash:", receipt.transactionHash);
    console.log("Gas used:", receipt.gasUsed);
    console.log("========================\n");
}

// ====== Script Config ======
const NUM_BIDDERS = 2;
const NFT_URI = "https://raw.githubusercontent.com/kailen-hargenrader/Ethereum_SPA/refs/heads/main/NFT_metadata.json";
const RESERVE_PRICE = "1.0";
const SECONDS_TILL_REVEAL = 5;
const SECONDS_TILL_END = 10;
const COMMIT_REVEAL_TRANSITION_FEE = "0.01";
const REVEAL_TO_END_TRANSITION_FEE = "0.01";
const FAILURE_TO_POST_FEE = "0.01";

// ====== Main Script ======
async function main() {
    let accounts;
    let seller;
    let bidders;
    let contractAddress;
    let tokenId;
    try {
        accounts = await getAccounts(NUM_BIDDERS + 1);
        seller = accounts[0];
        bidders = accounts.slice(1, NUM_BIDDERS + 1);

        console.log("Initial balances:");
        await printBalances(accounts);
        ({ contractAddress, tokenId } = await mintNFT(seller, NFT_URI));
    } catch(err) {
        console.log("THIS SHOULD NOT BREAK!");
        console.error("Reason: ", err.reason);
    } 
    let params;
    let paramsBad1;
    let paramsBad2;
    try {
        params = await getParams(
            RESERVE_PRICE,
            SECONDS_TILL_REVEAL,
            SECONDS_TILL_END,
            COMMIT_REVEAL_TRANSITION_FEE,
            REVEAL_TO_END_TRANSITION_FEE,
            FAILURE_TO_POST_FEE,
            contractAddress
        );
        paramsBad1 = await getParams(
            RESERVE_PRICE,
            SECONDS_TILL_END,
            SECONDS_TILL_REVEAL,
            COMMIT_REVEAL_TRANSITION_FEE,
            REVEAL_TO_END_TRANSITION_FEE,
            FAILURE_TO_POST_FEE,
            contractAddress
        );
        paramsBad2 = await getParams(
            "0.0",
            SECONDS_TILL_REVEAL,
            SECONDS_TILL_END,
            COMMIT_REVEAL_TRANSITION_FEE,
            REVEAL_TO_END_TRANSITION_FEE,
            FAILURE_TO_POST_FEE,
            contractAddress
        );
    } catch(err) {
        console.log("BAD PARAMETERS!");
        console.error("Reason: ", err.reason);
    } try {
        await deploySecondPriceAuction(seller, paramsBad1);
        console.log("SHOULD HAVE THROWN: COMMIT-REVEAL TIMES FLIPPED!");
    } catch(err) {
        console.log("Auction with paramsBad1 failed as expected.");
    } try {
        await deploySecondPriceAuction(seller, paramsBad2);
        console.log("SHOULD HAVE THROWN: RESERVE PRICE ZERO!");
    } catch(err) {
        console.log("Auction with paramsBad2 failed as expected.");
    } 
    let auction;
    try {
        auction = await deploySecondPriceAuction(seller, params);
        console.log("Auction with params succeeds as expected.");
    } catch(err) {
        console.log("SHOULD HAVE SUCCEEDED: PARAMS ARE VALID!");
    }
    await printBalances(bidders);
    let bid;
    let salt;
    try {
        await testBid(auction, bidders[0], "0.0", RESERVE_PRICE);
        console.log("Zero bid succeeds as expected.");
    } catch(err) {
        console.log("SHOULD HAVE SUCCEEDED: ALL BIDS ARE VALID IN COMMIT STAGE!");
        console.error("Message: ", err.message);
    } try {
        await testBid(auction, bidders[0], "2.0", "0.0");
        console.log("SHOULD HAVE THROWN: VALUE IS NOT RESERVE PRICE!");
    } catch(err) {
        console.log("Value mismatch failed as expected.");
    } 
    await printBalances(bidders);
    try {
        ({ bid, salt } = await testBid(auction, bidders[0], RESERVE_PRICE, RESERVE_PRICE));
        console.log("Ensure that bidder is not refunded reserve from first bid.");
    } catch(err) {
        console.log("SHOULD HAVE SUCCEEDED: ALL BIDS ARE VALID IN COMMIT STAGE!");
    }
    await printBalances(bidders);
    try {
        await auction.methods.transitionToReveal().send({ from: seller});
        console.log("SHOULD HAVE THROWN: NOT PAST REVEAL TIME YET!");
    } catch(err) {
        console.log("Early stage change failed as expected.");
    }   
    try {
        await testReveal(auction, bidders[0], bid, salt, bid);
        console.log("SHOULD HAVE THROWN: NOT IN REVEAL STAGE YET!");
    } catch(err) {
        console.log("Early reveal failed as expected.");
    }
    await sleep(5000);
    try {
        await auction.methods.transitionToReveal().send({ from: seller});
        console.log("On time stage change succeeds as expected.");
    } catch(err) {
        console.log("SHOULD HAVE SUCCEEDED: STAGE CHANGE IS ON TIME");
    } try {
        await testReveal(auction, bidders[1], bid, salt, bid);
        console.log("SHOULD HAVE THROWN: BIDDER 1 HAS NO BID TO REVEAL!");
    } catch(err) {
        console.log("Revealing non-existent bid failed as expected.");
    } try {
        await testReveal(auction, bidders[0], bid, salt, bid);
        console.log("revealing existent bid works at expected.");
    } catch(err) {
        console.log("SHOULD HAVE SUCCEEDED: BID EXISTS!");
    } try {
        await testReveal(auction, bidders[0], bid, salt, bid);
        console.log("SHOULD HAVE THROWN: BID HAS ALREADY BEEN REVEALED!");
    } catch(err) {
        console.log("Revealing reentrant bid failed as expected.");
    }
}

// ====== Run ======
main();