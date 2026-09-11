const updater = require('../updater');

const confirm = process.argv.indexOf('--confirm') >= 0;
if (!confirm) {
  updater.check().then(function (info) {
    if (info.message && !info.remote) {
      console.log(info.message);
      process.exit(1);
      return;
    }
    console.log('İndi ' + info.local + (info.remote ? ' • GitHub ' + info.remote : ''));
    if (info.newer) {
      console.log('Yeni versiya var. Quraşdırmaq üçün: node scripts/auto-update.js --confirm');
    }
    process.exit(info.newer ? 2 : 0);
  }).catch(function (error) {
    console.error(error.message || 'Yoxlama alınmadı.');
    process.exit(1);
  });
} else {
  updater.apply({ confirm: true }).then(function (out) {
    console.log(out.message || (out.ok ? 'Yeniləndi.' : 'Yeni versiya yoxdur.'));
    process.exit(out.ok ? 0 : 1);
  }).catch(function (error) {
    console.error(error.message || 'Yeniləmə alınmadı.');
    process.exit(1);
  });
}
