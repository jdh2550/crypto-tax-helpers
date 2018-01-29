const request = require('request');
const crypto = require('crypto');
const fs = require('fs');

let bittrex = { holdings: {},
                currentPrices: {},
                historicalPrices: {},
                withdrawals: {},
                deposits: {},
                warnings: [] }

var config = {
  'apikey' : process.env.BITTREX_API_KEY,
  'apisecret' : process.env.BITTREX_API_SECRET,
  'url' : 'https://www.bittrex.com/api/v1.1'
};

var callCount = 0;
var logCalls = true;

function req(url, cb) {
  callCount++
  if (logCalls) console.log(config.url+url)
  request({url:config.url+url}, function (e,r,b) {
    try {
      cb(e ? {error: e} : JSON.parse(b));
    } catch (e) {
      cb(e);
    }
    finally {
      callCount--;
    }
  })
}

function waitUntil(gate,cb) {
  if (gate()===true) {
    cb()
  }
  else {
    setTimeout(()=>waitUntil(gate,cb),200)
  }
}

function allCallsCompleted() {
  return callCount<=0;
}

function secReq(url, cb) {
  callCount++;

  function getNonce() {
    return Math.floor(new Date().getTime() / 1000);
    //return new Date().getTime();
  }

  let signedUrl = config.url + url+`?apikey=${config.apikey}&nonce=${getNonce()}`
  let signature = crypto
                  .createHmac('sha512', config.apisecret)
                  .update(signedUrl).digest('hex')
  if (logCalls) console.log(signedUrl)
  let options = {
    url: signedUrl,
    headers: {'apisign': signature}
  }
  request(options, function (e,r,b) {
    try {
      if (e) {
        console.log("Error response url: ", url, "error ", e)
        cb({error: e})
      }
      else {
        let j
        try { j = JSON.parse(b) }
        catch (e) {
          console.log("Unexpected format for response url: ",url, "response ", b)
          throw (e)
        }
        cb(j)
      }
    } catch (e) {
      cb(e);
    } finally {
      callCount--;
    }
  })

}

function loadHistoricalPrices(filename, year, symbol) {
  callCount++
  fs.readFile(filename, (err,data) => {
    if (err) {
      console.log(err)
    }
    else {
      let rows = data.toString().split("\n")
      data = {}
      rows.forEach((row) => {
        let cells = row.split('\t')
        if (cells[0] !== 'Date') {
          data[cells[0]] = parseFloat(cells[4]) // <-- CLOSING PRICE
        }
      })
      if (!bittrex.historicalPrices[symbol])
        bittrex.historicalPrices[symbol] = {}
      bittrex.historicalPrices[symbol][year] = data
      // console.log(data)
    }
    callCount--
  })
}

function gotBalances(resp) {
  // console.log(resp)
  balances = resp.result.filter((b) => {return b.Balance > 0})
  balances.forEach((b)=>bittrex.holdings[b.Currency] = Object.assign({},b))
  getTrades()
}

function getBalances() {
  secReq("/account/getbalances", gotBalances)
}

function gotTrades(resp) {
  resp.result.forEach((trade) => {
    let asset = trade.Exchange.split("-")[1]
    console.log("processing trade for", trade.TimeStamp, asset)
    if (!bittrex.holdings[asset]) bittrex.holdings[asset]={}
    let holding = bittrex.holdings[asset]
    if (!holding.trades) holding.trades = []
    holding.trades.push(Object.assign({},trade))
  })

}

function getTrades() {
  secReq("/account/getorderhistory", gotTrades)
}

function getWithdrawls() {
  secReq("/account/getwithdrawalhistory", (resp) => {
    bittrex.withdrawals = resp.result.filter((tx) => {return tx.Canceled == false});
  })
}

function getDeposits() {
  secReq("/account/getdeposithistory", (resp) => {
    bittrex.deposits = resp.result
  })
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function getCoinMarketCapStyleDateFromDate(date) {
  let month = MONTHS[date.getMonth()]
  let day = date.getDate() < 10 ? '0' : ''
  day += date.getDate()
  return month + ' ' + day + ', ' + date.getFullYear()
}

function getMarketPrice(market,year,date) {
  if (bittrex.historicalPrices[market]) {
    if (bittrex.historicalPrices[market][year]) {
      if (bittrex.historicalPrices[market][year][date]) {
        return bittrex.historicalPrices[market][year][date]
      }
      else {
        bittrex.warnings.push("No historical data available for " + market + " " + date)
      }
    }
    else {
      bittrex.warnings.push("No historical data available for " + market + " " + date)
    }
  }
  else {
    bittrex.warnings.push("No historical data available for " + market + " " + date)
  }
}

function updateTradesWithPriceInfo() {
  for(h in bittrex.holdings) {
    if (bittrex.holdings.hasOwnProperty(h)) {
      let asset = bittrex.holdings[h]
      if (asset.trades) {
        asset.trades.forEach((trade) => {
          let tt = new Date(trade.TimeStamp)
          let year = "" + tt.getFullYear()
          let d = getCoinMarketCapStyleDateFromDate(tt)
          let market = trade.Exchange.split("-")[0]
          trade.marketUSDMarketPrice = getMarketPrice(market,year,d)
          trade.commissionUSDMarketPrice = trade.marketUSDMarketPrice
        })
      }
    }
  }
}

function updateTransfersWithPriceInfo(transfers,timeField) {
  transfers.forEach((tx) => {
    let date = new Date(tx[timeField])
    let year = "" + date.getFullYear()
    let d = getCoinMarketCapStyleDateFromDate(date)
    tx.USDMarketPrice = getMarketPrice(tx.Currency, year, d)
  })
}

function getExchangeData(cb) {
  getBalances()
  getWithdrawls()
  getDeposits()
  loadHistoricalPrices("BTC2017.tsv", "2017", "BTC")
  loadHistoricalPrices("BTC2018.tsv", "2018", "BTC")

  setTimeout(()=>waitUntil(allCallsCompleted,()=>{
    updateTradesWithPriceInfo()
    updateTransfersWithPriceInfo(bittrex.deposits, 'LastUpdated')
    updateTransfersWithPriceInfo(bittrex.withdrawals, 'Opened')
    cb()
  }),200)
}

function showExchangeData() {
  console.log(JSON.stringify(bittrex,null,2))
}

function saveExchangeDataJSON() {
  fs.writeFile("bittrex_latest.json", JSON.stringify(bittrex,null,2), (err) => {
      if(err) return console.log(err);
      console.log("bittrex exchnage data saved to bittrex_latest.json");
  });
}

function saveTransfersTSV() {
  let output = ["Timestamp\tDate\tAsset\tAction\tAmount\tUSD Amount"]

  let transactionRows = []

  function makeRow(tx, isDeposit) {
    let timeField, multiplier, action
    if (isDeposit) {
      timeField = 'LastUpdated'
      multiplier = 1
      action = 'DEPOSIT'
    }
    else {
      timeField = 'Opened'
      multiplier = -1
      action = 'WITHDRAWAL'
    }
    let txDate = new Date(tx[timeField])
    let txRow =
      + txDate.getTime() + '\t'
      + getCoinMarketCapStyleDateFromDate(txDate) + '\t'
      + tx.Currency + '\t'
      + tx.Currency + '\t'
      + action + '\t'
      + tx.Amount + '\t'
      + 1 + '\t'
      + tx.USDMarketPrice
    transactionRows.push(txRow)

    return ''
      + txDate.getTime() + '\t'
      + getCoinMarketCapStyleDateFromDate(txDate) + '\t'
      + tx.Currency + '\t'
      + action + '\t'
      + (tx.Amount * multiplier) + '\t'
      + (tx.Amount * multiplier * tx.USDMarketPrice)
  }
  bittrex.deposits.forEach((tx) => {
    output.push(makeRow(tx, true))
  })
  bittrex.withdrawals.forEach((tx) => {
    output.push(makeRow(tx, false))
  })
  fs.writeFile("bittrex_transfers.tsv", output.join("\n"), function(err) {
      if(err) return console.log(err);
      console.log("bittrex deposit/withrdrawal information with historical prices from coinmarketcap.com was saved to bittrex_transfers.tsv");
  });
  return transactionRows
}

function saveTradesTSV() {
  let output = ["Timestamp\tDate\tAsset\tMarket\tAction\tQuantity\tPrice\tUSD Price\tCommission Price\tCommission Asset\tCommission USD Price"]

  function makeRow(symbol, trade) {
    let txDate = new Date(trade.TimeStamp)
    let market = trade.Exchange.split("-")[0]
    return ''
      + txDate.getTime() + '\t'
      + getCoinMarketCapStyleDateFromDate(txDate) + '\t'
      + symbol + '\t'
      + market + '\t'
      + trade.OrderType + '\t'
      + trade.Quantity + '\t'
      + trade.Price + '\t'
      + (trade.Price * trade.marketUSDMarketPrice) + '\t'
      + trade.Commission + '\t'
      + market + '\t'
      + (trade.Commission * trade.commissionUSDMarketPrice)
  }

  for(symbol in bittrex.holdings) {
    if (bittrex.holdings.hasOwnProperty(symbol)) {
      let asset = bittrex.holdings[symbol]
      if (asset.trades) {
        asset.trades.forEach((trade) => {
          output.push(makeRow(symbol,trade))
        })
      }
    }
  }

  fs.writeFile("bittrex_trades.tsv", output.join("\n"), function(err) {
      if(err) return console.log(err);
      console.log("bittrex trade information with historical prices from coinmarketcap.com was saved to bittrex_trades.tsv");
  });
  return output
}

function saveTransactionsTSV(trades, transfers) {
  let header = trades.shift()
  let output = trades.concat(transfers)
  output.sort()
  output.unshift(header)
  fs.writeFile("bittrex_transactions.tsv", output.join("\n"), function(err) {
      if(err) {
          return console.log(err);
      }
      console.log("bittrex_transactions.tsv contains both trades and transfers and is sorted by time");
  });
}

console.log("gathering data from bittrex")
getExchangeData(() => {
  saveExchangeDataJSON()
  let trades = saveTradesTSV()
  let transfers = saveTransfersTSV()
  saveTransactionsTSV(trades,transfers)
})
