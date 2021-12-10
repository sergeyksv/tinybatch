### Tiny batch - safe way to execute sequentional data retrieval server side

### Introduction
Very soon network latency migth not be issue anymore. However as of now executing function (REST calls) from client are suffering from network latency especially when functions can not be executed in parallel and have dependency of each other.

Typical examples are execution of one function to search for something which will return id only and further call to fetch objects by id. Or fetching some big object which has linked objects by id.

We've made multiple attempts to solve this problem taking different approaches like preapproved or signed scripts pushed from client to serves. Check "flexible" data retrieval approache like graphql (which actually nailed down to available implementaion and more exploration friendly rather that flexible). Considered use of limited scripting using Lua or Lisp. Primary challenge here is to provide flexible yet secure functionality which will also safe to execute in server context in terms of resourse use.

One of solution which has been proved by time is declarative description of what functions need to be called and how data need to be processed. First iteration, which used used till now, was created not in very friendly desciprive language which is hard to remember. Tiny batch is successor of this implemetation which supposed to be little more friendly.

### "Show me the code"

```
  const batch = {
    'projects.getReconciliationProjects': {
      save: 'projects',
      pluck: {
        '()': ['_id'],
        union: 'idProjects',
      },
      next: {
        'stories.stories_for_projects': {
          '()': {
            projectids: '$idProjects',
            allStatuses: true,
          },
          save: 'stories',
          pluck: {
            '()': ['list._id'],
            union: 'idStories',
          },
          next: {
            'timelogs.storytimelogs': {
              '()': {
                id: '$idStories',
                opt_unfixed: true,
              },
              save: 'timelogs',
            },
          },
        },
      },
    },
    next: {
      omit: ['idProjects', 'idStories'],
    },
  };
````

The code above is typical batch. This batch describes following operation:
1. Execute function `projects.getReconciliationProjects`
2. Peek ids of returned project and store them as `idProjects` variable
3. Then execute function `stories.stories_for_projects` passing ids of project obtained before along with `allStatuses` paramater
4. Save result as `stories` variable
5. Collect id of stories and store them as `idStories` variable
6. Then execute function `timelogs.storytimelogs` passing collected above story ids and opt_unfixed paramater
7. Save results as `timelogs` variable
8. Remove from final result `idProjects` and `idStories` as redundant.

## Concept of batch structure

Batch is a JSON object. Keys of object represent actions with some subset of batch actions and extensible set of user action. Actions on save level are executed in parallel. Batch action `next` is used to define actions (or next level of batch) that should be executed once all actions on current level will be completed.

For every action it should be possible to define paramaters using action key `()`. Paramaters can be defined statically or through variables which are denoted with `$` character. Variables are resolving using dot notaion from local, data and batch context. Batch context is used to accumulate results of action execution. It can be also used to store intermidiate data. Data context is provided upon batch call and can be used to hold big variables like array of ids. Data context is more for batch readability. Finally local context represent result of action execution.

Special key action `{}` is used to define action (or sub batch) that should be executed on same level. 

## Batch actions (buildins)

In general we are fans of functional programming and Javascript so we like Lodash. So majority of actions lodash functions to manipulate the data. 

In most cases batch action paramaters are as simple as just varibale name. So for simplicity action which is defined with trivial variable (not an object or array) is implicetly transformved to variable paramater. I.e. following two definitions are equialent:
```
omit:"idProjects"
```
```
omit:{
    "()":"idProjects"
}
```

If batch action is defined via array this indirectly translates into execution of same action with each element of array executed in parallel. I.e. folling defention will execute omit two times, with "idProjects" and "idStories" paramaters:
```
omit: ['idProjects', 'idStories']
```

### Save

Most simple action. Just store local context as is to named varibale inside batch context

### Union

Lodash `_.union`. Typically used to collect unique ids from multiple function calls

### Pluck

Legacy alike lodash "_.pluck" functionality. Typically used to collect ids from complex objects or arrays including nested objects and arrays. `pluck` does not modify context so need to be chained to function that store data

```
"pluck":{
    "()":["users.id"],
    "compact":{
        "union":"res"
    }
}
```
Example above traverse data and collected all data from `user.id` path, then remove undefined data and finally save unique selection

### Omit

Used to remove/delete certain varibles.

### Concat

Lodash `_.concat` 

### Compact

Lodash `_.compact` 

### Push

Pretty much standard array.push

### Loop

Used to execute repetetive actions in a loop. Repetetive actions should be defined using `{}` batch key. Iteratee value is provided through `$loop` variable and definded as `on` parameter
By default execute action in series one by one. This behavior can be changed with `limit` paramater which will define number of "threads". When limit is >1 (which is default) execution sequence is not guaranteed. 
```
"loop":{
    "()":{"on":[{v:1},{v:2},{v:3},{v:4}],"limit":3},
    "{}":{ 
        "dummy":{
            "()":"$loop",
            "union":"result"
        }
    }
}
```

### next
Used to execute next level of functions that can depend on result obtained on previous level. No local data passed to next level expect thouse that was purposely saved in batch context. `next` can be exeuted conditionally by providing "if" parameter which value is examined like inside if condition in order to execute next block. 
```
"dummy":{
    "()":{},
    "save":"outer",
    "next":{
        "()":{"if":"$outer"},
        "{}":{
            "dummy":{
                "()":{v:$outer.something},
                "save":"inner"
            }
        }
    }
}
```

## How to use
Typical usecase to use batch is to create a helper function (usually REST endpoint) that will accept batch and data. Note, that batch itself with just batch actions is useless, you have to extend this through defenition of custom actions. Simpliied wrapper function can be like this:

```
// we need to define static and "wildcard" alike custom functions
// note, it is up to implementation to ensure that these functions are safe
// typically only wild card function is defined which just expose existing public API
const batchActions:{
    myFunction1:async (params) => {
        return params.a+params.b;
    },
    internalApi: {
        match: ".*",
				action: async (actionName, params) {
            // dynamical bind some action, like internal api by action name
        }
    }
}

// "api" alike function
function batchCall(batch, data) {
   let batchContext={actions:batchActions};
   await runBatch(batchContext, batch, data);
   
   return batchContext.result;
 }
 ```
