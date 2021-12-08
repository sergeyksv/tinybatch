const run_batch = require("../index.js").batch;

var assert = require('assert');
const { result } = require("lodash");
describe('Batch', function() {
  describe('execution', function() {
    let index = 0;
    const bctx = {
        actions: {
            inc1: async () => {
                return [index++];
            },
            inc2: async () => {
                let i = index++;
                await new Promise(resolve => setTimeout(resolve, 10))
                return [i];
            },
            inc3: async () => {
                return [index++];
            },                        
            one: async () => {
                return [1];
            },
            two: async () => {
                return [2];
            },
            three: async () => {
                return [3];
            }
        }
    }

    it('should be in sequence with next', async function() {
        delete bctx.result;
        var res = await run_batch(bctx,{
            "one":{
                "union": "result",
                "next": {
                    "two": {
                        "union": "result",
                        "next": {
                            "three":{
                                "union": "result"
                            }
                        }
                    }
                }
            }
        },{});
        assert.deepStrictEqual(bctx.result.result,[1,2,3]);
    });

    it('should be in parallel on same level', async function() {
        delete bctx.result;
        var res = await run_batch(bctx,{
            "inc1":{
                "union": "result",
            },
            "inc2":{
                "union": "result",
            },
            "inc3":{
                "union": "result",
            }
        },{});
        assert.deepStrictEqual(bctx.result.result,[0,2,1]);
    });
  });

  describe('wild card action', function () {
    const bctx = {
        actions: {
            apiCall:{
                match:"api\..*",
                action: async (action, params) => {
                    if (action=="api.dummy") {
                        return params.v;
                    } else throw new Error ("Api is not implemented");
                }
            }
        }
    }
    it("is supported", async function () {
        await run_batch(bctx,{
            "api.dummy":{
                "()":{v:1976},
                "save":"dummy"
            }
        })
        assert.deepStrictEqual(bctx.result.dummy,1976);
    })
  })

  describe('action next', function() {
    const bctx = {
        actions: {
            dummy:async (prm) => {
                return prm.v;
            }
        }
    }

    it('can be conditional', async function() {
        delete bctx.result; execCnt = 0; maxExecCnt = 0;        
        var res = await run_batch(bctx,{
            "dummy":{
                "()":{},
                "save":"outer",
                "next":[{
                    "()":{"if":"$outer"},
                    "{}":{
                        "dummy":{
                            "()":{v:1},
                            "save":"inner"
                        }
                    }
                },
                {
                    "{}":{
                        "dummy":{
                            "()":{v:3},
                            "save":"inner2"
                        }
                    }
                }]
            }
        });
        assert.deepStrictEqual(bctx.result,{inner2:3,outer:undefined});
    });
});

  describe('action loop', function() {
    let execCnt = 0;
    let maxExecCnt = 0;
    const bctx = {
        actions: {
            dummy:async (prm) => {
                execCnt++;
                if (execCnt>maxExecCnt) maxExecCnt=execCnt;
                await new Promise(resolve => setTimeout(resolve, 40-10*prm.v))
                execCnt--;
                return prm.v;
            }
        }
    }

    it('execute in sequence by default', async function() {
        delete bctx.result; execCnt = 0; maxExecCnt = 0;        
        var res = await run_batch(bctx,{
            "loop":{
                "()":{"on":[{v:1},{v:2},{v:3},{v:4}]},
                "{}":{ 
                    "dummy":{
                        "()":"$loop",
                        "concat":"result"
                    }
                }
            }
        },{});
        assert.deepStrictEqual(bctx.result.result,[1,2,3,4]);
        assert.strictEqual(maxExecCnt,1);
    });

    it('execute in limit "threads" when defined', async function() {
        delete bctx.result; execCnt = 0; maxExecCnt = 0;  
        var res = await run_batch(bctx,{
            "loop":{
                "()":{"on":[{v:1},{v:2},{v:3},{v:4}],"limit":3},
                "{}":{ 
                    "dummy":{
                        "()":"$loop",
                        "union":"result"
                    }
                }
            }
        },{});
        assert.strictEqual(maxExecCnt,3);
    });
  });

});