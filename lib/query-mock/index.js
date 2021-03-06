'use strict';

const callbackUtil = require('../util/callback-util');
const queryChainableFunctions = require('../function-mappings/query-chainable-functions');
const deepEqual = require('deep-equal');

// Unfortunately can't just return the Query mock directly due to caching so instead we return a builder function
module.exports = () => {
  class Query {
    constructor() {
      // Store the previously defined assertion chain and set up an execution chain to track the mock's execution
      this.assertionChains = Query.proto._chains;
      this.executionChain = { chain: [], returns: null };

      // Remove the proto object so that the mock cannot be redefined after it is instantiated
      delete Query.proto;
    }

    then(resolve, reject) {
      return this.exec().then(resolve, reject);
    }

    catch(reject) {
      return this.exec().then(null, reject);
    }

    exec(...args) {
      // Grab the return data from the last chain in the execution so that we can use it and then clear it out
      const executingChainReturns = this.executionChain.returns;
      this.executionChain = { chain: [], returns: null };

      const callback = callbackUtil.getCallback(args);

      if (callback !== null) {
        callback(executingChainReturns.err, executingChainReturns.data);
      }
      else if (executingChainReturns.err != null) {
        return Promise.reject(executingChainReturns.err);
      }
      else {
        return Promise.resolve(executingChainReturns.data);
      }
    }
  }

  // Set up the object that will contain the assertion functions used by testers
  Query.proto = {
    _chains: [ { chain: [], returns: null } ],
    returns: (err, data) => {
      const latestChain = Query.proto._chains[Query.proto._chains.length - 1];
      latestChain.returns = { err, data };
      Query.proto._chains.push({ chain: [], returns: null });
    }
  };

  // Create a sub-proto object so that testers can chain another .proto off of withArgs()
  Query.proto.proto = Query.proto;

  // Set up the chainable query functions
  for (const chainableFunction of queryChainableFunctions) {
    Query.prototype[chainableFunction.name] = function (...args) {
      const argsWithoutCallback = callbackUtil.getArgumentsWithoutCallback(args);
      this.executionChain.chain.push({ name: chainableFunction.name, args: argsWithoutCallback });

      for (const assertionChain of this.assertionChains) {
        // Remove links from the assertion chain so that we can accurately assess the execution
        const assertionChainMatchingExecution = assertionChain.chain.slice(0, this.executionChain.chain.length);

        if (deepEqual(this.executionChain.chain, assertionChainMatchingExecution)) {
          // Update the execution chain returns value so that the two have parity
          this.executionChain.returns = assertionChain.returns;

          // Call the callback or return the Query so that the next part of the chain can continue
          // But only allow a callback to be called if the query function supports it
          const callback = callbackUtil.getCallback(args);
          if (chainableFunction.callback === true && callback != null) {
            return callback(assertionChain.returns.err, assertionChain.returns.data);
          }
          else {
            return this;
          }
        }
      }

      // Match does not exist for the currently executing chain, throw an error
      throw new Error(`invoked query with incorrect chain: ${JSON.stringify(this.executionChain.chain)}`);
    };

    Query.proto[chainableFunction.name] = {
      withArgs: (...argMatchers) => {
        const chain = Query.proto._chains[Query.proto._chains.length - 1].chain;
        chain.push({ name: chainableFunction.name, args: argMatchers });
        return Query.proto;
      }
    };
  }

  // Return the Query that we built
  return Query;
};
