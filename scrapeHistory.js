const request = require('request');
const cheerio = require('cheerio');
const fs = require('fs');

function writeDailyHistoricalPricesTSV(filename,year,market) {
  let options = {
    url: `https://coinmarketcap.com/currencies/${market}/historical-data/?start=${year}0101&end=${year}1231`
  }
  request(options,(e,r,b) =>{

    let $ = cheerio.load(b)
    let thead = $('#historical-data table thead tr')
    let tbody = $('#historical-data table tbody tr')

    function makeRow(e) {
      return $(e).text().split("\n").map((c)=>{return c.trim()}).filter((c)=>{return c.length>0})
    }

    let output=[]

    let headers = makeRow(thead[0])
    output.push(headers.join('\t'))

    tbody.each((i,e)=> {
      let row = makeRow(e)
      output.push(row.join('\t'))
    })

    fs.writeFile(filename, output.join("\n"), function(err) {
        if(err) {
            return console.log(err);
        }
        console.log(filename,"was saved!  Thanks coinmarketcap.com!");
    });
  })
}

if (process.argv.length != 5) {
  console.log("\tusage: node scrapeHistory.js <output file name> <year> <coinmarketcap.com name (e.g. bitcoin not BTC)>")
  console.log("\t\tcreates a tab seperated variable file (tsv) with daily historical data for the given year and symbol")
  console.log("\t\tall data comes from www.coinmarketcap.com")
  process.exit(1)
}
writeDailyHistoricalPricesTSV(process.argv[2],process.argv[3],process.argv[4])
