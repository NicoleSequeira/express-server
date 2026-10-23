const bcrypt = require('bcryptjs');

async function run() {
    const password = 'CorrectHorseBatteryStaple!';

    const hashA = await bcrypt.hash(password, 12);
    const hashB = await bcrypt.hash(password, 12);

    console.log('Hash A:', hashA);
    console.log('Hash B:', hashB);
    console.log('A verifies:', await bcrypt.compare(password, hashA));
    console.log('B verifies:', await bcrypt.compare(password, hashB));
}

run().catch((error) => {
    console.error('Hash demo failed:', error);
    process.exit(1);
});

// 1) Salts make equal passwords produce different hashes while both still verify.
// 2) You cannot recover the original password from a bcrypt hash.
// 3) Bcrypt is intentionally slow, making large-scale password guessing expensive.
