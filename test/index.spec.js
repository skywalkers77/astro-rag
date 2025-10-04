import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('RAG AI Tutorial worker', () => {
	it('responds to questions (unit style)', async () => {
		const request = new Request('http://example.com/?text=What is 2+2?');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		const responseText = await response.text();
		expect(responseText).toBeTruthy();
		expect(response.status).toBe(200);
	});

	it('responds to questions (integration style)', async () => {
		const response = await SELF.fetch('http://example.com/?text=What is 2+2?');
		const responseText = await response.text();
		expect(responseText).toBeTruthy();
		expect(response.status).toBe(200);
	});

	it('accepts text notes for ingestion', async () => {
		const request = new Request('http://example.com/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: 'This is a test note' })
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(201);
		expect(await response.text()).toBe('Created note');
	});

	it('accepts PDF notes for ingestion', async () => {
		const request = new Request('http://example.com/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ 
				filename: 'test-document.pdf',
				pdfUrl: 'https://example.com/test.pdf'
			})
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(201);
		expect(await response.text()).toBe('Created PDF note: test-document.pdf');
	});

	it('rejects requests without text or pdfUrl', async () => {
		const request = new Request('http://example.com/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Missing text or pdfUrl');
	});

	it('rejects PDF requests without filename', async () => {
		const request = new Request('http://example.com/ingest', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ pdfUrl: 'https://example.com/test.pdf' })
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe('Missing filename for PDF');
	});
});
