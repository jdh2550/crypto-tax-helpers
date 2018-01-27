# Crypto Tax Helper Scripts

This directory contains a couple of simple node.js scripts to assist with gathering exchange data for US tax reporting purposes.

_*These scripts are as-is and come with no warranty as fit for purpose. *_

_*I'm not your mama nor your accountant.  So, go get the proper advice of a licensed financial professional and remember that taxes are (a) hard to figure out on your own and (b) a necessary evil (just ask Al Capone what happens if you don't pay)*_

The data that appears to be missing when downloading trades from most exchanges is the market price of the market currency in terms of USD *at the time of the trade*.  This is necessary because one must calculate the cost basis and profit/loss in terms of USD and then one can figure out Uncle Sam's cut in the same fashion as a stock trade.

_*At least I think that's how it's supposed to work...*_

Note: These scripts and instructions assume you have knowledge of how to run node.js and how to install dependencies.  A later version might make it all more user friendly...  Or not.

## scrapeHistory.js

This script can be used to get the historical data for an asset from [Coin Market Cap](https://www.coinmarketcap.com) and put it into a tab separated file (TSV) for later use.

### Dependencies
* request, fs & cheerio

### Usage
```
usage: node scrapeHistory.js <output file name> <year> <coinmarketcap.com name (e.g. bitcoin not BTC)>
		creates a tab seperated variable file (tsv) with daily historical data for the given year and symbol
		all data comes from www.coinmarketcap.com
```

### Example
```
> node scrapeHistory.js BTC2017.tsv 2017 bitcoin

BTC2017.tsv was saved!  Thanks coinmarketcap.com!
```

## binance.js

This script can be used to gather all the trade, withdrawal and deposit information and combine it with the historical price data that was in effect at the time of the transaction.  It will make some useful tsv which you or accountant should be able to use to calculate your taxes.  It doesn't actually do the tax calculations.  But it does give you all the data you need in one place.

### Dependencies
* request, fs, URL, crypto

### Installation
Before running set up two environment variables that contain your key information
```
setenv BINANCE_API_KEY= your key from the binance website
setenv BINANCE_API_SECRET= your secret for this key from the binance website
```
Note, a later version will probably manage your keys better than this.

You will also need the historical data for BTC & BNB for 2017 and 2018 - these files are provided for you.  (Also see the limitations section!)

### Usage
```
node binance.js
```

### Example
```
> node binance.js

gathering data from binance
binance trade information with historical prices from coinmarketcap.com was saved to binance_trades.tsv
binance exchnage data saved to binance_latest.json
binance deposit/withrdrawal information with historical prices from coinmarketcap.com was saved to binance_transfers.tsv
binance_transactions.tsv contains both trades and transfers and is sorted by time
```
The files created should contain the information they say they do!  If you look at the tsv's and see a bunch of NaNs where you expect numbers then read the 'limitations' section (ditto if you look at the json file and see a bunch of warnings)

### Limitations

* It only collects trade data if you have a current non-zero balance on binance.  
* As written it only has data for BTC based trades which use BNB as the commission asset.  If you have ETH or USDT trades then you'll see a NaN appear in the output files. In theory it should be straightforward to address this (in theory because I don't have any non BTC trades on binance so I haven't tested it).  You'll just need to use the scrape script (above) to gather the historical data and then you'll need to add a `loadHistoricalPrices` call in the `getExchangeData` function.
