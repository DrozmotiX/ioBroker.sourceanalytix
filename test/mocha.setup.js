// Don't silently swallow unhandled rejections
process.on("unhandledRejection", (e) => {
	throw e;
});

// The @iobroker/testing framework provides chai, sinon, and other testing utilities internally
// No need to explicitly require them here