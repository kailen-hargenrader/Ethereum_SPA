# Ethereum_SPA
A Second Price Auction contract on Ethereum

### Mint NFT
1. get a publicly available link to an image.
2. put the link in the image field of NFT_metadata.json
3. commit and push NFT_metadata.json to github
4. copy link to raw NFT_metadata.json file, this is the uri you will need
5. open this repository in remixIDE
6. compile Class_NFT.sol
7. If using Sepolia, paste 0x1546Bd67237122754D3F0cB761c139f81388b210 into At Address field
8. Else click deploy (costs gas)
9. Navigate to deployed contracts and safeMint
10. paste uri into the uri field
11. click safeMint button (costs gas)
12. Copy token_id (output field) to NFTs.json to keep track of them
13. Call Owner function on the token_id

### SPAFactory Contract Address on Sepolia
0x70cc2757fa4af1d9c7ddfec813fd14426cc3a592