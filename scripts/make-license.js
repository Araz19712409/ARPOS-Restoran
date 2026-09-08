const license = require('../license');

const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf('--' + name);
  if (i < 0) {
    return '';
  }
  return args[i + 1] || '';
}

if (args[0] === '--init' || args.indexOf('--init') >= 0) {
  const out = license.initKeys();
  if (out.existed) {
    console.log('Açarlar artıq var. Özəli GitHub-a qoymayın: keys/arpos-private.pem');
  } else {
    console.log('Yeni açarlar yaradıldı.');
    console.log('Özəl (gizli): ' + out.private);
    console.log('Açıq: ' + out.public);
  }
  process.exit(0);
}

const out = license.issue({
  name: flag('name'),
  days: flag('days'),
  machine: flag('machine')
});
if (out.error) {
  console.error(out.error);
  console.error('Nümunə: node scripts/make-license.js --name "Cafe Nur" --machine ABCD-EF01-2345-6789');
  process.exit(1);
}
console.log(out.token);
if (out.expires) {
  console.log('Bitir: ' + new Date(out.expires * 1000).toISOString().slice(0, 10));
}
