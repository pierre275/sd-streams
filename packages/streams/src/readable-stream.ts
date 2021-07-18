/**
 * streams/readable-stream - ReadableStream class implementation
 * Part of Stardazed
 * (c) 2018-Present by @zenmumbler
 * https://github.com/stardazed/sd-streams
 */

import * as rs from "./readable-internals";
import * as ws from "./writable-internals";
import * as shared from "./shared-internals";
import { pipeTo } from "./pipe-to";

import { ReadableStreamDefaultController, setUpReadableStreamDefaultControllerFromUnderlyingSource } from "./readable-stream-default-controller";
import { ReadableStreamDefaultReader } from "./readable-stream-default-reader";

import { ReadableByteStreamController, setUpReadableByteStreamControllerFromUnderlyingSource } from "./readable-byte-stream-controller";
import { SDReadableStreamBYOBReader } from "./readable-stream-byob-reader";

export class SDReadableStream<OutputType> implements rs.SDReadableStream<OutputType> {
	[shared.state_]: rs.ReadableStreamState;
	[shared.storedError_]: shared.ErrorResult;
	[rs.reader_]: rs.SDReadableStreamReader<OutputType> | undefined;
	[rs.readableStreamController_]: rs.SDReadableStreamControllerBase<OutputType>;

	constructor(underlyingSource: UnderlyingByteSource, strategy?: { highWaterMark?: number, size?: undefined });
	constructor(underlyingSource?: UnderlyingSource<OutputType>, strategy?: QueuingStrategy<OutputType>);
	constructor(underlyingSource: UnderlyingSource<OutputType> | UnderlyingByteSource = {}, strategy: QueuingStrategy<OutputType> | { highWaterMark?: number, size?: undefined } = {}) {
		rs.initializeReadableStream(this);

		const sizeFunc = strategy.size;
		const stratHWM = strategy.highWaterMark;
		const sourceType = underlyingSource.type;

		if (sourceType === undefined) {
			const sizeAlgorithm = shared.makeSizeAlgorithmFromSizeFunction(sizeFunc);
			const highWaterMark = shared.validateAndNormalizeHighWaterMark(stratHWM === undefined ? 1 : stratHWM);
			setUpReadableStreamDefaultControllerFromUnderlyingSource(this, underlyingSource as UnderlyingSource<OutputType>, highWaterMark, sizeAlgorithm);
		}
		else if (String(sourceType) === "bytes") {
			if (sizeFunc !== undefined) {
				throw new RangeError("bytes streams cannot have a strategy with a `size` field");
			}
			const highWaterMark = shared.validateAndNormalizeHighWaterMark(stratHWM === undefined ? 0 : stratHWM);
			setUpReadableByteStreamControllerFromUnderlyingSource(this as unknown as rs.SDReadableStream<ArrayBufferView>, underlyingSource as UnderlyingByteSource, highWaterMark);
		}
		else {
			throw new RangeError("The underlying source's `type` field must be undefined or 'bytes'");
		}
	}

	get locked(): boolean {
		return rs.isReadableStreamLocked(this);
	}

	getReader(): rs.SDReadableStreamDefaultReader<OutputType>;
	getReader(options: { mode?: "byob" }): rs.SDReadableStreamBYOBReader;
	getReader(options?: { mode?: "byob" }): rs.SDReadableStreamDefaultReader<OutputType> | rs.SDReadableStreamBYOBReader {
		if (! rs.isReadableStream(this)) {
			throw new TypeError();
		}
		if (options === undefined) {
			options = {};
		}
		const { mode } = options;
		if (mode === undefined) {
			return new ReadableStreamDefaultReader(this);
		}
		else if (String(mode) === "byob") {
			return new SDReadableStreamBYOBReader(this as unknown as rs.SDReadableStream<ArrayBufferView>);
		}
		throw RangeError("mode option must be undefined or `byob`");
	}

	cancel(reason: shared.ErrorResult): Promise<void> {
		if (! rs.isReadableStream(this)) {
			return Promise.reject(new TypeError());
		}
		if (rs.isReadableStreamLocked(this)) {
			return Promise.reject(new TypeError("Cannot cancel a locked stream"));
		}
		return rs.readableStreamCancel(this, reason);
	}

	tee(): SDReadableStream<OutputType>[] {
		return readableStreamTee(this, false);
	}

	pipeThrough<ResultType>(transform: rs.GenericTransformStream<OutputType, ResultType>, options: PipeOptions = {}): rs.SDReadableStream<ResultType> {
		const { readable, writable } = transform;
		if (! rs.isReadableStream(this)) {
			throw new TypeError();
		}
		if (! ws.isWritableStream(writable)) {
			throw new TypeError("writable must be a WritableStream");
		}
		if (! rs.isReadableStream(readable)) {
			throw new TypeError("readable must be a ReadableStream");
		}
		if (options.signal !== undefined && !shared.isAbortSignal(options.signal)) {
			throw new TypeError("options.signal must be an AbortSignal instance");
		}
		if (rs.isReadableStreamLocked(this)) {
			throw new TypeError("Cannot pipeThrough on a locked stream");
		}
		if (ws.isWritableStreamLocked(writable)) {
			throw new TypeError("Cannot pipeThrough to a locked stream");
		}

		const pipeResult = pipeTo(this, writable, options);
		pipeResult.catch(() => {});

		return readable;
	}

	pipeTo(dest: ws.WritableStream<OutputType>, options: PipeOptions = {}): Promise<void> {
		if (! rs.isReadableStream(this)) {
			return Promise.reject(new TypeError());
		}
		if (! ws.isWritableStream(dest)) {
			return Promise.reject(new TypeError("destination must be a WritableStream"));
		}
		if (options.signal !== undefined && !shared.isAbortSignal(options.signal)) {
			return Promise.reject(new TypeError("options.signal must be an AbortSignal instance"));
		}
		if (rs.isReadableStreamLocked(this)) {
			return Promise.reject(new TypeError("Cannot pipe from a locked stream"));
		}
		if (ws.isWritableStreamLocked(dest)) {
			return Promise.reject(new TypeError("Cannot pipe to a locked stream"));
		}
		
		return pipeTo(this, dest, options);
	}
}

export function createReadableStream<OutputType>(startAlgorithm: rs.StartAlgorithm, pullAlgorithm: rs.PullAlgorithm<OutputType>, cancelAlgorithm: rs.CancelAlgorithm, highWaterMark?: number, sizeAlgorithm?: QueuingStrategySizeCallback<OutputType>) {
	if (highWaterMark === undefined) {
		highWaterMark = 1;
	}
	if (sizeAlgorithm === undefined) {
		sizeAlgorithm = () => 1;
	}
	// Assert: ! IsNonNegativeNumber(highWaterMark) is true.

	const stream = Object.create(SDReadableStream.prototype) as SDReadableStream<OutputType>;
	rs.initializeReadableStream(stream);
	const controller = Object.create(ReadableStreamDefaultController.prototype) as ReadableStreamDefaultController<OutputType>;
	rs.setUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm);
	return stream;
}

export function createReadableByteStream<OutputType>(startAlgorithm: rs.StartAlgorithm, pullAlgorithm: rs.PullAlgorithm<OutputType>, cancelAlgorithm: rs.CancelAlgorithm, highWaterMark?: number, autoAllocateChunkSize?: number) {
	if (highWaterMark === undefined) {
		highWaterMark = 0;
	}
	// Assert: ! IsNonNegativeNumber(highWaterMark) is true.
	if (autoAllocateChunkSize !== undefined) {
		if (! shared.isInteger(autoAllocateChunkSize) || autoAllocateChunkSize <= 0) {
			throw new RangeError("autoAllocateChunkSize must be a positive, finite integer");
		}
	}

	const stream = Object.create(SDReadableStream.prototype) as SDReadableStream<OutputType>;
	rs.initializeReadableStream(stream);
	const controller = Object.create(ReadableByteStreamController.prototype) as ReadableByteStreamController;
	rs.setUpReadableByteStreamController(stream as unknown as SDReadableStream<ArrayBufferView>, controller, startAlgorithm, pullAlgorithm as unknown as rs.PullAlgorithm<ArrayBufferView>, cancelAlgorithm, highWaterMark, autoAllocateChunkSize);
	return stream;
}

export function readableStreamTee<OutputType>(stream: SDReadableStream<OutputType>, cloneForBranch2: boolean) {
	if (! rs.isReadableStream(stream)) {
		throw new TypeError();
	}

	const reader = new ReadableStreamDefaultReader(stream);
	let closedOrErrored = false;
	let canceled1 = false;
	let canceled2 = false;
	let reason1: shared.ErrorResult;
	let reason2: shared.ErrorResult;
	let branch1: SDReadableStream<OutputType>;
	let branch2: SDReadableStream<OutputType>;

	let cancelResolve: (reason: shared.ErrorResult) => void;
	const cancelPromise = new Promise<void>(resolve => cancelResolve = resolve);

	const pullAlgorithm = () => {
		return rs.readableStreamDefaultReaderRead(reader).then(
			({ value, done }) => {
				if (done && !closedOrErrored) {
					if (! canceled1) {
						rs.readableStreamDefaultControllerClose(branch1![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>);
					}
					if (! canceled2) {
						rs.readableStreamDefaultControllerClose(branch2![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>);
					}
					if (canceled1 === false || canceled2 === false) {
						cancelResolve(undefined);
					}		
					closedOrErrored = true;
				}
				if (closedOrErrored) {
					return;
				}
				const value1 = value;
				let value2 = value;
				if (! canceled1) {
					rs.readableStreamDefaultControllerEnqueue(branch1![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>, value1!);
				}
				if (! canceled2) {
					if (cloneForBranch2) {
						value2 = shared.cloneValue(value2);
					}
					rs.readableStreamDefaultControllerEnqueue(branch2![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>, value2!);
				}
			});
	};

	const cancel1Algorithm = (reason: shared.ErrorResult) => {
		canceled1 = true;
		reason1 = reason;
		if (canceled2) {
			const cancelResult = rs.readableStreamCancel(stream, [reason1, reason2]);
			cancelResolve(cancelResult);
		}
		return cancelPromise;
	};

	const cancel2Algorithm = (reason: shared.ErrorResult) => {
		canceled2 = true;
		reason2 = reason;
		if (canceled1) {
			const cancelResult = rs.readableStreamCancel(stream, [reason1, reason2]);
			cancelResolve(cancelResult);
		}
		return cancelPromise;
	};

	const startAlgorithm = () => undefined;
	branch1 = createReadableStream(startAlgorithm, pullAlgorithm, cancel1Algorithm);
	branch2 = createReadableStream(startAlgorithm, pullAlgorithm, cancel2Algorithm);

	reader[rs.closedPromise_].promise.catch(error => {
		if (! closedOrErrored) {
			rs.readableStreamDefaultControllerError(branch1![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>, error);
			rs.readableStreamDefaultControllerError(branch2![rs.readableStreamController_] as ReadableStreamDefaultController<OutputType>, error);
			if (canceled1 === false || canceled2 === false) {
				cancelResolve(undefined);
			}
			closedOrErrored = true;
		}
	});

	return [branch1, branch2];
}
