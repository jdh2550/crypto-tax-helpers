const request = require('request');
const crypto = require('crypto');
const URL = require('url');
const fs = require('fs');

let binance = { holdings: {},
                currentPrices: {},
                historicalPrices: {},
                withdrawals: {},
                deposits: {},
                warnings: [] }

var config = {
  'apikey' : process.env.BINANCE_API_KEY,
  'apisecret' : process.env.BINANCE_API_SECRET,
  'url' : 'https://www.binance.com/api',
  'urlw' : 'https://www.binance.com/wapi'
};

var callCount = 0;
var logCalls = false;

function req(url, cb) {
  callCount++
  if (logCalls) console.log(config.url+url)
  request({url:config.url+url}, function (e,r,b) {
    try {
      callCount--;
      cb(e ? {error: e} : JSON.parse(b));
    } catch (e) {
      callCount--;
      cb(e);
    }
  })
}

function secReq(url, cb) {
  callCount++;
  function doReq() {

    // parse the URL
    let useWapi = url.startsWith("/w/")
    if (useWapi) url = url.substr(2)
    let parsedUrl = URL.parse(url)

    // add the timestamp
    let timestamp = (new Date()).getTime() + config.timeDelta;
    let qry = parsedUrl.query
    if (qry!=null && qry.length>0) qry += "&"
    else qry = ""
    qry += "timestamp="+timestamp

    // create the signed url
    let signedUrl = url
    if (parsedUrl.search != null)
      signedUrl = signedUrl.replace(parsedUrl.search, "")
    let signature = crypto
                    .createHmac('sha256', config.apisecret)
                    .update(qry).digest('hex')
    qry+="&signature="+signature
    signedUrl=(useWapi ? config.urlw : config.url)+signedUrl+"?"+qry
    if (logCalls) console.log(signedUrl)

    // call binance
    let options = {
      url: signedUrl,
      headers: {'x-mbx-apikey': config.apikey}
    }
    request(options, function (e,r,b) {
      // console.log(e,b)
      try {
        callCount--;
        cb(e ? {error: e} : JSON.parse(b));
      } catch (e) {
        callCount--;
        cb(e);
      }
    })

  }

  function getServerTime() {
    if (logCalls) console.log(config.url+"/v1/time")
    request({url:config.url+"/v1/time"}, (e,r,b)=> {
      try {
        config.serverTime = JSON.parse(b).serverTime
        config.timeDelta = config.serverTime - (new Date()).getTime();
        doReq()
      } catch (e) {
        console.log(e)
      }
    })
  }

  config.serverTime ? doReq() : getServerTime();
}

function waitUntil(gate,cb) {
  if (gate()===true) {
    cb()
  }
  else if (gate()===false){
    setTimeout(()=>waitUntil(gate,cb),200)
  }
  else {
    console.log("pass in function that evaluates to true or false for gate")
  }
}

function allCallsCompleted() {
  return callCount<=0;
}

function getCurrentPrices() {
  req("/v1/ticker/allPrices", (prices) => {
    if (prices[0]) {
      prices.forEach((p) => binance.currentPrices[p.symbol]=parseFloat(p.price))
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
      if (!binance.historicalPrices[symbol])
        binance.historicalPrices[symbol] = {}
      binance.historicalPrices[symbol][year] = data
      // console.log(data)
    }
    callCount--
  })
}

function gotTrades(market,asset,trades) {
  if (trades[0]) {
    binance.holdings[asset].trades = trades
    trades.forEach((t) => t.market = market)
  }
}

function getTrades(assets,market) {
  assets.forEach((a) => {
    secReq("/v3/myTrades?symbol="+a.asset+market, (t) => gotTrades(market,a.asset,t))
  })
}

function gotBalances(resp) {
  balances = resp.balances.filter((b) => {return parseFloat(b.free) + parseFloat(b.locked) > 0})
  balances.forEach((b)=>binance.holdings[b.asset] = Object.assign({},b))
  getTrades(balances, "BTC")
  getTrades(balances, "ETH")
  getTrades(balances, "USDT")
}

function getBalances() {
  secReq("/v3/account", gotBalances)
}

function getWithdrawls() {
  secReq("/w/v3/withdrawHistory.html", (resp) => {
    binance.withdrawals = resp.withdrawList;
  })
}

function getDeposits() {
  secReq("/w/v3/depositHistory.html", (resp) => {
    binance.deposits = resp.depositList;
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
  if (binance.historicalPrices[market]) {
    if (binance.historicalPrices[market][year]) {
      if (binance.historicalPrices[market][year][date]) {
        return binance.historicalPrices[market][year][date]
      }
      else {
        binance.warnings.push("No historical data available for " + market + " " + date)
      }
    }
    else {
      binance.warnings.push("No historical data available for " + market + " " + date)
    }
  }
  else {
    binance.warnings.push("No historical data available for " + market + " " + date)
  }
}

function updateTradesWithPriceInfo() {
  for(h in binance.holdings) {
    if (binance.holdings.hasOwnProperty(h)) {
      let asset = binance.holdings[h]
      if (asset.trades) {
        asset.trades.forEach((trade) => {
          let tt = new Date(trade.time)
          let year = "" + tt.getFullYear()
          let d = getCoinMarketCapStyleDateFromDate(tt)
          trade.marketUSDMarketPrice = getMarketPrice(trade.market,year,d)
          trade.commissionUSDMarketPrice = getMarketPrice(trade.commissionAsset, year, d)
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
    tx.USDMarketPrice = getMarketPrice(tx.asset, year, d)
  })
}

function getExchangeData(cb) {
  getBalances()
  getWithdrawls()
  getDeposits()
  getCurrentPrices()
  loadHistoricalPrices("BTC2017.tsv", "2017", "BTC")
  loadHistoricalPrices("BNB2017.tsv", "2017", "BNB")
  loadHistoricalPrices("BTC2018.tsv", "2018", "BTC")
  loadHistoricalPrices("BNB2018.tsv", "2018", "BNB")

  setTimeout(()=>waitUntil(allCallsCompleted,()=>{
    updateTradesWithPriceInfo()
    updateTransfersWithPriceInfo(binance.deposits, 'insertTime')
    updateTransfersWithPriceInfo(binance.withdrawals, 'applyTime')
    cb()
  }),200)
}

function showExchangeData() {
  console.log(JSON.stringify(binance,null,2))
}

function saveExchangeData() {
  fs.writeFile("binance_latest.json", JSON.stringify(binance,null,2), function(err) {
      if(err) {
          return console.log(err);
      }
      console.log("binance exchnage data saved to binance_latest.json");
  });
}

function saveTransfers() {
  let output = ["Timestamp\tDate\tAsset\tAction\tAmount\tUSD Price"]

  let transactionRows = []

  function makeRow(tx, isDeposit) {
    let timeField, multiplier, action
    if (isDeposit) {
      timeField = 'insertTime'
      multiplier = 1
      action = 'DEPOSIT'
    }
    else {
      timeField = 'applyTime'
      multiplier = -1
      action = 'WITHDRAWAL'
    }
    let txRow =
      + tx[timeField] + '\t'
      + getCoinMarketCapStyleDateFromDate(new Date(tx[timeField])) + '\t'
      + tx.asset + '\t'
      + tx.asset + '\t'
      + action + '\t'
      + tx.amount + '\t'
      + 1 + '\t'
      + tx.USDMarketPrice
    transactionRows.push(txRow)

    return ''
      + tx[timeField] + '\t'
      + getCoinMarketCapStyleDateFromDate(new Date(tx[timeField])) + '\t'
      + tx.asset + '\t'
      + action + '\t'
      + (tx.amount * multiplier) + '\t'
      + (tx.amount * multiplier * tx.USDMarketPrice)
  }
  binance.deposits.forEach((tx) => {
    output.push(makeRow(tx, true))
  })
  binance.withdrawals.forEach((tx) => {
    output.push(makeRow(tx, false))
  })
  fs.writeFile("binance_transfers.tsv", output.join("\n"), function(err) {
      if(err) {
          return console.log(err);
      }
      console.log("binance deposit/withrdrawal information with historical prices from coinmarketcap.com was saved to binance_transfers.tsv");
  });
  return transactionRows
}

function saveTradesTSV() {
  let output = ["Timestamp\tDate\tAsset\tMarket\tAction\tQuantity\tPrice\tUSD Price\tCommission Price\tCommission Asset\tCommission USD Price"]

  function makeRow(symbol, trade) {
    return ''
      + trade.time + '\t'
      + getCoinMarketCapStyleDateFromDate(new Date(trade.time)) + '\t'
      + symbol + '\t'
      + trade.market + '\t'
      + (trade.isBuyer===true ? 'BUY' : 'SELL') + '\t'
      + trade.qty + '\t'
      + trade.price + '\t'
      + (trade.price * trade.marketUSDMarketPrice) + '\t'
      + trade.commission + '\t'
      + trade.commissionAsset + '\t'
      + (trade.commission * trade.commissionUSDMarketPrice)
  }

  for(symbol in binance.holdings) {
    if (binance.holdings.hasOwnProperty(symbol)) {
      let asset = binance.holdings[symbol]
      if (asset.trades) {
        asset.trades.forEach((trade) => {
          output.push(makeRow(symbol,trade))
        })
      }
    }
  }

  fs.writeFile("binance_trades.tsv", output.join("\n"), function(err) {
      if(err) {
          return console.log(err);
      }
      console.log("binance trade information with historical prices from coinmarketcap.com was saved to binance_trades.tsv");
  });
  return output
}

function saveTransactions(trades, transfers) {
  let header = trades.shift()
  let output = trades.concat(transfers)
  output.sort()
  output.unshift(header)
  fs.writeFile("binance_transactions.tsv", output.join("\n"), function(err) {
      if(err) {
          return console.log(err);
      }
      console.log("binance_transactions.tsv contains both trades and transfers and is sorted by time");
  });
}

console.log("gathering data from binance")
getExchangeData(() => {
  saveExchangeData()
  let trades = saveTradesTSV()
  let transfers = saveTransfers()
  saveTransactions(trades,transfers)
})
