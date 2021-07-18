/**
 * streams/writable-stream - WritableStream class implementation
 * Part of Stardazed
 * (c) 2018-Present by @zenmumbler
 * https://github.com/stardazed/sd-streams
 */

import * as ws from "./writable-internals";
import * as shared from "./shared-internals";
import { WritableStreamDefaultController, setUpWritableStreamDefaultControllerFromUnderlyingSink } from "./writable-stream-default-controller";
import { WritableStreamDefaultWriter } from "./writable-stream-default-writer";

export class WritableStream<InputType> {
	[shared.state_]: ws.WritableStreamState;
	[shared.storedError_]: shared.ErrorResult;
	[ws.backpressure_]: boolean;
	[ws.closeRequest_]: shared.ControlledPromise<void> | undefined;
	[ws.inFlightWriteRequest_]: shared.ControlledPromise<void> | undefined;
	[ws.inFlightCloseRequest_]: shared.ControlledPromise<void> | undefined;
	[ws.pendingAbortRequest_]: ws.AbortRequest | undefined;
	[ws.writableStreamController_]: ws.WritableStreamDefaultController<InputType> | undefined;
	[ws.writer_]: ws.WritableStreamDefaultWriter<InputType> | undefined;
	[ws.writeRequests_]: shared.ControlledPromise<void>[];

	constructor(sink: ws.WritableStreamSink<InputType> = {}, strategy: QueuingStrategy<InputType> = {}) {
		ws.initializeWritableStream(this);
		const sizeFunc = strategy.size;
		const stratHWM = strategy.highWaterMark;
		if (sink.type !== undefined) {
			throw new RangeError("The type of an underlying sink must be undefined");
		}

		const sizeAlgorithm = shared.makeSizeAlgorithmFromSizeFunction(sizeFunc);
		const highWaterMark = shared.validateAndNormalizeHighWaterMark(stratHWM === undefined ? 1 : stratHWM);

		setUpWritableStreamDefaultControllerFromUnderlyingSink(this, sink, highWaterMark, sizeAlgorithm);
	}

	get locked(): boolean {
		if (! ws.isWritableStream(this)) {
			throw new TypeError();
		}
		return ws.isWritableStreamLocked(this);
	}

	abort(reason?: shared.ErrorResult): Promise<void> {
		if (! ws.isWritableStream(this)) {
			return Promise.reject(new TypeError());
		}
		if (ws.isWritableStreamLocked(this)) {
			return Promise.reject(new TypeError("Cannot abort a locked stream"));
		}
		return ws.writableStreamAbort(this, reason);
	}

	getWriter(): ws.WritableStreamWriter<InputType> {
		if (! ws.isWritableStream(this)) {
			throw new TypeError();
		}
		return new WritableStreamDefaultWriter(this);
	}
}

export function createWritableStream<InputType>(startAlgorithm: ws.StartAlgorithm, writeAlgorithm: ws.WriteAlgorithm<InputType>, closeAlgorithm: ws.CloseAlgorithm, abortAlgorithm: ws.AbortAlgorithm, highWaterMark?: number, sizeAlgorithm?: QueuingStrategySize<InputType>) {
	if (highWaterMark === undefined) {
		highWaterMark = 1;
	}
	if (sizeAlgorithm === undefined) {
		sizeAlgorithm = () => 1;
	}
	// Assert: ! IsNonNegativeNumber(highWaterMark) is true.

	const stream = Object.create(WritableStream.prototype) as WritableStream<InputType>;
	ws.initializeWritableStream(stream);
	const controller = Object.create(WritableStreamDefaultController.prototype) as WritableStreamDefaultController<InputType>;
	ws.setUpWritableStreamDefaultController(stream, controller, startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm, highWaterMark, sizeAlgorithm);
	return stream;
}
