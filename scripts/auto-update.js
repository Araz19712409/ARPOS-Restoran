const updater = require('../updater');

updater.apply().then(function (out) {
  console.log(out.message || (out.ok ? 'Yeniləndi.' : 'Yeni versiya yoxdur.'));
  process.exit(out.ok ? 0 : 1);
}).catch(function (error) {
  console.error(error.message || 'Yeniləmə alınmadı.');
  process.exit(1);
});
