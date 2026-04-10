const url = "https://docs.google.com/spreadsheets/d/124VcfNpFqJKv400Jj156h2aYg4eurDzfJaEvs_wbNQ4/gviz/tq?tqx=out:json&gid=1227076939";

async function run() {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            console.error("HTTP Err:", response.status);
            return;
        }
        const text = await response.text();
        console.log(text.substring(0, 300));
    } catch (err) {
        console.error(err);
    }
}
run();
