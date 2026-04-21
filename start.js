const { run } = require('./utils/login');
const { buildRuntimeOptions } = require('./utils/cli');

(async () => {
    const runtimeOptions = await buildRuntimeOptions();
    await run(runtimeOptions);
})().catch(err => {
    console.error('❌ 程序异常:', err);
    process.exit(1);
});
