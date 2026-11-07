const app = { get(...args: unknown[]) {} }
function fake() {}
app.get('/fake', fake)
