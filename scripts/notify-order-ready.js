#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });
const {
    normalizeOrderSummary,
    createOrderSummaryPdf,
    sendOrderReadyPush,
} = require('../order-ready');

const OUTPUT_DIR = path.join(ROOT_DIR, 'output', 'pdf');
const WEEKLY_PLAN_FILE = path.join(ROOT_DIR, 'data', 'weekly-plan.json');
const NOTIFICATION_STATE_FILE = path.join(ROOT_DIR, 'data', 'order-notification-state.json');

function parseArgs(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--test') result.test = true;
        else if (arg === '--input') result.input = argv[++index];
        else if (arg === '--idempotency-key') result.idempotencyKey = argv[++index];
        else if (arg === '--output') result.output = argv[++index];
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!result.input) throw new Error('Usage: notify-order-ready --input <summary.json> [--idempotency-key <key>] [--test]');
    return result;
}

function safeReadJson(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return fallback;
    }
}

function atomicWriteJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
    fs.renameSync(tempPath, filePath);
}

function safeFileTimestamp(isoDate) {
    return isoDate.replace(/[:.]/g, '-');
}

function normalizeIdempotencyKey(value) {
    const key = String(value || '').trim();
    if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(key)) {
        throw new Error('idempotency key must contain 8-120 letters, numbers, dots, colons, underscores, or hyphens');
    }
    return key;
}

function markWeeklyPlanProcessed(reportPath, completedAt) {
    const plan = safeReadJson(WEEKLY_PLAN_FILE, null);
    if (!plan || typeof plan !== 'object') return;
    atomicWriteJson(WEEKLY_PLAN_FILE, {
        ...plan,
        orderReady: false,
        lastPreparedAt: completedAt,
        lastReport: path.relative(ROOT_DIR, reportPath),
        updatedAt: new Date().toISOString(),
    });
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const raw = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
    const summary = normalizeOrderSummary({ ...raw, test: args.test || raw.test === true });
    const defaultKey = `kitchen:${summary.store}:${summary.completedAt}`;
    const idempotencyKey = normalizeIdempotencyKey(args.idempotencyKey || defaultKey.replace(/[^a-zA-Z0-9._:-]/g, '-'));
    const state = safeReadJson(NOTIFICATION_STATE_FILE, { notifications: [] });
    const previous = Array.isArray(state.notifications)
        ? state.notifications.find(entry => entry.idempotencyKey === idempotencyKey)
        : null;

    if (previous && !summary.test) {
        process.stdout.write(`${JSON.stringify({ ok: true, duplicate: true, reportPath: previous.reportPath })}\n`);
        return;
    }

    const fileName = summary.test
        ? 'prueba-compra-preparada.pdf'
        : `compra-preparada-${safeFileTimestamp(summary.completedAt)}.pdf`;
    const reportPath = path.resolve(args.output || path.join(OUTPUT_DIR, fileName));
    await createOrderSummaryPdf(summary, reportPath);
    const push = await sendOrderReadyPush({
        token: process.env.PUSHBULLET_TOKEN,
        summary,
        pdfPath: reportPath,
        idempotencyKey,
    });

    if (!summary.test) {
        const notifications = (Array.isArray(state.notifications) ? state.notifications : [])
            .filter(entry => entry.idempotencyKey !== idempotencyKey)
            .concat({
                idempotencyKey,
                notifiedAt: new Date().toISOString(),
                reportPath: path.relative(ROOT_DIR, reportPath),
                pushId: push.iden || null,
            })
            .slice(-50);
        atomicWriteJson(NOTIFICATION_STATE_FILE, { version: 1, notifications });
        markWeeklyPlanProcessed(reportPath, summary.completedAt);
    }

    process.stdout.write(`${JSON.stringify({
        ok: true,
        test: summary.test,
        reportPath,
        pushId: push.iden || null,
    })}\n`);
}

main().catch(error => {
    process.stderr.write(`Order-ready notification failed: ${error.message}\n`);
    process.exitCode = 1;
});
