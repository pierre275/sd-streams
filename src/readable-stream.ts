/**
 * streams/readable-stream - ReadableStream implementation
 * (c) 2018 by Arthur Langereis - @zenmumbler
 * https://github.com/stardazed/sd-streams
 */

import * as rs from "./readable-internals";
import { WritableStream } from "./writable-internals";
import { readableStreamPipeTo } from "./transform-internals";

import { ReadableStreamDefaultController } from "./readable-stream-default-controller";
import { ReadableStreamDefaultReader } from "./readable-stream-default-reader";

import { ReadableByteStreamController } from "./readable-byte-stream-controller";
import { ReadableStreamBYOBReader } from "./readable-stream-byob-reader";

interface RSInternalConstructorOptions {
	startAlgorithm: rs.StartAlgorithm;
	pullAlgorithm: rs.PullAlgorithm;
	cancelAlgorithm: rs.CancelAlgorithm;
	highWaterMark?: number;
	sizeAlgorithm?: rs.SizeAlgorithm;
}

export class ReadableStream implements rs.ReadableStream {
	[rs.state_]: rs.ReadableStreamState;
	[rs.reader_]: rs.ReadableStreamReader | undefined;
	[rs.storedError_]: any;
	[rs.readableStreamController_]: rs.ReadableStreamController;

	constructor(source: rs.ReadableStreamSource = {}, strategy: rs.StreamStrategy = {}, _1?: never, _2?: never, internalCtor?: RSInternalConstructorOptions) {
		this[rs.state_] = "readable";
		this[rs.reader_] = undefined;
		this[rs.storedError_] = undefined;
		(this as any)[rs.readableStreamController_] = undefined;

		// allow for internal constructor parameters to be passed in 5th parameter
		// ignores other parameters
		if (arguments.length === 5 && typeof internalCtor === "object" && internalCtor !== null) {
			// CreateReadableStream algorithm (§3.3.3)
			if (internalCtor.highWaterMark === undefined) {
				internalCtor.highWaterMark = 1;
			}
			if (internalCtor.sizeAlgorithm === undefined) {
				internalCtor.sizeAlgorithm = function() { return 1; };
			}
			// Assert: IsNonNegativeNumber(highWaterMark) is true
			new ReadableStreamDefaultController(this, internalCtor.startAlgorithm, internalCtor.pullAlgorithm, internalCtor.cancelAlgorithm, internalCtor.highWaterMark, internalCtor.sizeAlgorithm);
			return;
		}

		const sourceType = source.type;
		const sourcePull = source.pull;
		const sourceStart = source.start;
		const stratHWM = strategy.highWaterMark;

		if (sourceType === undefined) {
			const cancelAlgorithm = rs.createAlgorithmFromUnderlyingMethod(source, "cancel", []);
			const sizeAlgorithm = rs.makeSizeAlgorithmFromSizeFunction(strategy.size);
			const highWaterMark = rs.validateAndNormalizeHighWaterMark(stratHWM === undefined ? 1 : stratHWM);
			new ReadableStreamDefaultController(this, sourceStart && sourceStart.bind(source), sourcePull && sourcePull.bind(source), cancelAlgorithm, highWaterMark, sizeAlgorithm);
		}
		else if (String(sourceType) === "bytes") {
			if (strategy.size !== undefined) {
				throw new RangeError("Strategy cannot specify `size` for a stream of type 'bytes'.");
			}
			const highWaterMark = rs.validateAndNormalizeHighWaterMark(stratHWM === undefined ? 0 : stratHWM);
			const cancelAlgorithm = rs.createAlgorithmFromUnderlyingMethod(source, "cancel", []);
			const autoAllocateChunkSize = source.autoAllocateChunkSize;
			new ReadableByteStreamController(this, sourceStart && sourceStart.bind(source), sourcePull && sourcePull.bind(source), cancelAlgorithm, highWaterMark, autoAllocateChunkSize);
		}
		else {
			throw new RangeError("The underlying source's `type` field must be undefined or 'bytes'");
		}
	}

	get locked(): boolean {
		return rs.isReadableStreamLocked(this);
	}

	getReader(options: rs.ReadableStreamReaderOptions = {}): rs.ReadableStreamReader {
		if (! rs.isReadableStream(this)) {
			throw new TypeError();
		}
		const { mode } = options;
		if (mode === undefined) {
			return new ReadableStreamDefaultReader(this);
		}
		else if (String(mode) === "byob") {
			throw new ReadableStreamBYOBReader(this);
		}
		throw RangeError("mode option must be undefined or `byob`");
	}

	cancel(reason: any): Promise<void> {
		if (! rs.isReadableStream(this)) {
			return Promise.reject(new TypeError());
		}
		if (rs.isReadableStreamLocked(this)) {
			return Promise.reject(new TypeError("Cannot cancel a locked stream"));
		}
		return rs.readableStreamCancel(this, reason);
	}

	tee(): ReadableStream[] {
		if (! rs.isReadableStream(this)) {
			throw new TypeError();
		}
		// Assert: Type(cloneForBranch2) is Boolean.

		const reader = new ReadableStreamDefaultReader(this);
		let closedOrErrored = false;
		let canceled1 = false;
		let canceled2 = false;
		let reason1: string | undefined;
		let reason2: string | undefined;
		let branch1: ReadableStream;
		let branch2: ReadableStream;

		let cancelResolve: (reason: any) => void;
		const cancelPromise = new Promise<void>(resolve => cancelResolve = resolve);

		const pullAlgorithm = () => {
			return rs.readableStreamDefaultReaderRead(reader).then(
				({ value, done }) => {
					if (done && !closedOrErrored) {
						if (! canceled1) {
							rs.readableStreamDefaultControllerClose(branch1![rs.readableStreamController_] as ReadableStreamDefaultController);
						}
						if (! canceled2) {
							rs.readableStreamDefaultControllerClose(branch2![rs.readableStreamController_] as ReadableStreamDefaultController);
						}
						closedOrErrored = true;
					}
					if (closedOrErrored) {
						return;
					}
					const value1 = value, value2 = value;
					if (! canceled1) {
						rs.readableStreamDefaultControllerEnqueue(branch1![rs.readableStreamController_] as ReadableStreamDefaultController, value1);
					}
					if (! canceled2) {
						rs.readableStreamDefaultControllerEnqueue(branch2![rs.readableStreamController_] as ReadableStreamDefaultController, value2);
					}
				});
		};

		const cancel1Algorithm = (reason: any) => {
			canceled1 = true;
			reason1 = reason;
			if (canceled2) {
				const cancelResult = rs.readableStreamCancel(this, [reason1, reason2]);
				cancelResolve(cancelResult);
			}
			return cancelPromise;
		};

		const cancel2Algorithm = (reason: any) => {
			canceled2 = true;
			reason2 = reason;
			if (canceled1) {
				const cancelResult = rs.readableStreamCancel(this, [reason1, reason2]);
				cancelResolve(cancelResult);
			}
			return cancelPromise;
		};

		const startAlgorithm = () => undefined;
		branch1 = new ReadableStream(undefined, undefined, undefined, undefined, { startAlgorithm, pullAlgorithm, cancelAlgorithm: cancel1Algorithm });
		branch2 = new ReadableStream(undefined, undefined, undefined, undefined, { startAlgorithm, pullAlgorithm, cancelAlgorithm: cancel2Algorithm });

		reader[rs.closedPromise_].promise.catch(error => {
			if (! closedOrErrored) {
				rs.readableStreamDefaultControllerError(branch1![rs.readableStreamController_] as ReadableStreamDefaultController, error);
				rs.readableStreamDefaultControllerError(branch2![rs.readableStreamController_] as ReadableStreamDefaultController, error);
				closedOrErrored = true;
			}
		});

		return [branch1, branch2];
	}

	pipeThrough(transform: rs.StreamTransform, options?: rs.PipeToOptions): ReadableStream {
		const { readable, writable } = transform;
		if (readable === undefined || writable === undefined) {
			throw new TypeError("Both a readable and writable stream must be provided");
		}
		this.pipeTo(writable, options).then(_ => {}, _error => {});
		return readable;
	}

	pipeTo(dest: WritableStream, options: rs.PipeToOptions = {}): Promise<void> {
		return readableStreamPipeTo(this, dest, options);
	}
}
