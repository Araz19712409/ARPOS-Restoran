const tails = {};

function withLock(name, fn) {
  const prev = tails[name] || Promise.resolve();
  const run = prev.then(function () {
    return fn();
  }, function () {
    return fn();
  });
  tails[name] = run.then(function () {
    return null;
  }, function () {
    return null;
  });
  return run;
}

module.exports = {
  withLock: withLock
};
