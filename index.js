'use strict';
const util = require('util');
const _ = require('lodash');

async function save(bctx, params, data) {
  bctx.result[params] = data;
}

async function omit(bctx, params, data) {
  delete bctx.result[params];
}

async function union(bctx, params, data) {
  bctx.result[params] = _.union(bctx.result[params] || [], data);
}

async function concat(bctx, params, data) {
  bctx.result[params] = _.concat(bctx.result[params] || [], data);
}

async function compact(bctx, params, data) {
  return _.compact(data);
}

async function push(bctx, params, data) {
    if (!bctx.result[params])
        bctx.result[params] = [];
    bctx.result[params].push(data);
}

function _pluck(path, idx, obj) {
  const part = obj[path[idx]];

  if (_.isUndefined(part) && _.isArray(obj)) {
    // arrays are "transparent for pluck", we just tapping inside to any level deep
    return _.flatMap(obj, (e) => _pluck(path, idx, e));
  } else if (idx == path.length - 1) {
    // last path element, return what is on the way
    return part;
  } else if (_.isArray(part)) {
    // when not last in path element we will tap into array
    return _.flatMap(part, (e) => _pluck(path, idx + 1, e));
  } else if (_.isObject(part)) {
    // when not last in the path, tap into object
    return _pluck(path, idx + 1, part);
  } else {
    // path not complete, empty result
    return undefined;
  }
}

async function pluck(bctx, params, data) {
  return _pluck(params[0].split('.'), 0, data);
}

async function loop(bctx, params, data, bcode) {
    const futures = _.map(params.on, (param) => {
        return async function () { await run_batch(bctx, bcode, data, {loop:param})
    }});
    const limit = params.limit || 1;
    if (limit==1) {
        for (const future of futures) {
            await future();
        }
    } else {
        let rest = futures.slice(limit);
        await Promise.all(futures.slice(0, limit).map(async future => {
            await future();
            while (rest.length) {
                await rest.shift()();
            }
        }));
    }    
}

const batch_actions = {
  save,
  union,
  pluck,
  omit,
  loop,
  concat,
  push,
  compact
};

function _lookup(bctx, v, data, ldata) {
  if (_.isString(v) && v.startsWith('$')) {
      const k = v.substring(1);
    return _.get(ldata,k) || _.get(data,k) || _.get(bctx.result, k);
  } else return v;
}

function _resolveArguments(bctx, args, data, ldata) {
  let res;
  if (_.isArray(args)) {
    res = [];
    _.each(args, (v) => {
      res.push(_lookup(bctx, v, data, ldata));
    });
  } else if (_.isObject(args)) {
    res = {};
    _.each(args, (v, k) => {
      if (_.isObject(v)) res[k] = _resolveArguments(bctx, v, data, ldata);
      else res[k] = _lookup(bctx, v, data, ldata);
    });
  } else res = _lookup(bctx, args, data, ldata);
  return res;
}

async function run_batch(bctx, batch, data, ldata) {
  bctx.result = bctx.result || {};
  let actions = [];
  _.each(batch, function (v, k) {
    if (k == 'next' || k=='{}') return;
    if (batch_actions[k]) {
      _.each(_.isArray(v) ? v : [v], (v) => {
        actions.push(
          (async () => {
            const result = await batch_actions[k](
              bctx,
              _resolveArguments(bctx, _.isObject(v) ? v['()'] : v, data, ldata),
              data,
              _.isObject(v) ? v['{}'] : null
            );
            if (_.isObject(v)) run_batch(bctx, _.omit(v, '()'), result);
          })()
        );
      });
    } else {
      actions.push(
        (async () => {
            let result;
            if (_.isFunction(bctx.actions[k]))
                result = await bctx.actions[k](_resolveArguments(bctx, v['()'],data,ldata)  || {});
            else {
                // fallback to wildcard
                const futures = _.chain(bctx.actions).filter((action) => {
                    if (action.match && k.match(action.match))
                        return true;
                }).map(action => action.action).value();
                if (futures.length>1) throw new Error("Multiple wild card actions matches are not allowed")
                if (futures.length==0)  throw new Error("Unknown action")
                result = await futures[0](k, _resolveArguments(bctx, v['()'],data,ldata)  || {});
            }
            return run_batch(bctx, _.omit(v, '()'), result);
        })()
      );
    }
  });
    await Promise.all(actions);
    if (batch.next) {
        actions = [];
        let v = batch.next;
        _.each(_.isArray(v) ? v : [v], (v) => {      
            if (v["{}"]) {        
                const nextParams = _resolveArguments(bctx, v['()'],data,ldata);
                if (!_.has(nextParams,"if") || nextParams.if) {
                    actions.push((async() => run_batch(bctx, v["{}"], data))());
                } 
            } else
                actions.push((async() => run_batch(bctx, v, data))());
        });
        await Promise.all(actions);
    }
}

module.exports.batch = run_batch;