const fs = require('fs');
const https = require('https');
const Papa = require('papaparse'); // need to install?

const url = 'https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/export?format=csv&gid=1227076939';

https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        const parsed = Papa.parse(data, { header: false });
        console.log("Raw grid:");
        for (let i = 0; i < 6; i++) {
            console.log(`ROW ${i}:`, parsed.data[i]);
        }
    });
});
