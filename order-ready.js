const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const PDFDocument = require('pdfkit');

const STATUS_LABELS = {
    added: 'Añadido',
    'already-present': 'Ya estaba',
    missing: 'No encontrado',
    manual: 'Revisión manual',
};

const STATUS_COLORS = {
    added: '#2f855a',
    'already-present': '#2563a6',
    missing: '#c2413b',
    manual: '#a05a16',
};

function cleanText(value, maxLength, fieldName) {
    const text = String(value || '').trim();
    if (!text || text.length > maxLength) {
        throw new Error(`${fieldName} must contain between 1 and ${maxLength} characters`);
    }
    return text;
}

function cleanTextList(value, maxItems, maxLength, fieldName) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > maxItems) {
        throw new Error(`${fieldName} must be an array with at most ${maxItems} entries`);
    }
    return value.map((item, index) => cleanText(item, maxLength, `${fieldName}[${index}]`));
}

function normalizeOrderSummary(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('Order summary must be an object');
    }
    if (!Array.isArray(input.items) || input.items.length > 500) {
        throw new Error('items must be an array with at most 500 entries');
    }

    const completedAt = input.completedAt ? new Date(input.completedAt) : new Date();
    if (Number.isNaN(completedAt.getTime())) {
        throw new Error('completedAt must be a valid date');
    }

    const total = input.total === undefined || input.total === null || input.total === ''
        ? null
        : Number(input.total);
    if (total !== null && (!Number.isFinite(total) || total < 0 || total > 100000)) {
        throw new Error('total must be a positive number');
    }

    let basketUrl = null;
    if (input.basketUrl) {
        const parsed = new URL(String(input.basketUrl));
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.href.length > 1000) {
            throw new Error('basketUrl must be a valid HTTP or HTTPS URL');
        }
        basketUrl = parsed.href;
    }

    const items = input.items.map((item, index) => {
        const status = item?.status || 'added';
        if (!Object.prototype.hasOwnProperty.call(STATUS_LABELS, status)) {
            throw new Error(`items[${index}].status is invalid`);
        }
        const price = item.price === undefined || item.price === null || item.price === ''
            ? null
            : Number(item.price);
        if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
            throw new Error(`items[${index}].price must be a positive number`);
        }
        return {
            name: cleanText(item?.name, 200, `items[${index}].name`),
            quantity: cleanText(item?.quantity || '1', 80, `items[${index}].quantity`),
            status,
            price,
        };
    });

    return {
        store: cleanText(input.store || 'Supermercado', 60, 'store'),
        completedAt: completedAt.toISOString(),
        items,
        total,
        currency: cleanText(input.currency || 'EUR', 8, 'currency').toUpperCase(),
        missing: cleanTextList(input.missing, 100, 300, 'missing'),
        notes: cleanTextList(input.notes, 100, 500, 'notes'),
        recipes: cleanTextList(input.recipes, 40, 200, 'recipes'),
        basketUrl,
        test: input.test === true,
    };
}

function formatDate(isoDate) {
    return new Intl.DateTimeFormat('es-ES', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Europe/Madrid',
    }).format(new Date(isoDate));
}

function formatMoney(value, currency = 'EUR') {
    if (value === null) return 'No indicado';
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(value);
}

function createOrderSummaryPdf(input, outputPath) {
    const summary = normalizeOrderSummary(input);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 52, right: 54, bottom: 56, left: 54 },
            bufferPages: true,
            info: {
                Title: summary.test ? 'Informe de prueba de compra' : 'Compra preparada para revisión',
                Author: 'Kitchen Dashboard',
                Subject: 'Resumen de cesta preparado para revisión',
            },
        });
        const stream = fs.createWriteStream(outputPath);
        stream.on('finish', () => resolve({ outputPath, summary }));
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);

        const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
        const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 24;

        const ensureSpace = (height) => {
            if (doc.y + height > bottomLimit()) doc.addPage();
        };
        const sectionTitle = (title) => {
            ensureSpace(40);
            doc.moveDown(0.8)
                .font('Helvetica-Bold').fontSize(13).fillColor('#193a4a')
                .text(title, doc.page.margins.left, doc.y, { width: pageWidth });
            doc.moveDown(0.35);
        };
        const bulletList = (items, color = '#23343d') => {
            items.forEach(item => {
                const height = doc.heightOfString(item, { width: pageWidth - 18 }) + 7;
                ensureSpace(height);
                const y = doc.y;
                doc.circle(doc.page.margins.left + 3, y + 5, 2.2).fill('#5c9d86');
                doc.font('Helvetica').fontSize(10).fillColor(color)
                    .text(item, doc.page.margins.left + 14, y, { width: pageWidth - 14 });
                doc.moveDown(0.28);
            });
        };

        doc.roundedRect(0, 0, doc.page.width, 150, 0).fill('#153f4d');
        doc.font('Helvetica-Bold').fontSize(23).fillColor('#ffffff')
            .text(summary.test ? 'PRUEBA - Compra preparada' : 'Compra preparada para revisión', 54, 48, { width: pageWidth });
        doc.font('Helvetica').fontSize(10.5).fillColor('#d9edf0')
            .text(`${summary.store} · ${formatDate(summary.completedAt)}`, 54, 86, { width: pageWidth });
        doc.y = 174;

        if (summary.test) {
            const testNoticeY = doc.y;
            doc.roundedRect(54, testNoticeY, pageWidth, 39, 6).fill('#fff3cd');
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#7a4b00')
                .text('INFORME DE PRUEBA - no corresponde a una cesta ni a un pedido real.', 68, testNoticeY + 13, { width: pageWidth - 28 });
            doc.y = testNoticeY + 51;
        }

        const addedCount = summary.items.filter(item => ['added', 'already-present'].includes(item.status)).length;
        const issueCount = summary.items.filter(item => ['missing', 'manual'].includes(item.status)).length + summary.missing.length;
        const cardY = doc.y;
        const gap = 10;
        const cardWidth = (pageWidth - gap * 2) / 3;
        [
            ['Productos listos', String(addedCount)],
            ['Pendientes', String(issueCount)],
            ['Total observado', formatMoney(summary.total, summary.currency)],
        ].forEach(([label, value], index) => {
            const x = 54 + index * (cardWidth + gap);
            doc.roundedRect(x, cardY, cardWidth, 60, 6).fill('#eef5f3');
            doc.font('Helvetica').fontSize(8.5).fillColor('#557078').text(label.toUpperCase(), x + 12, cardY + 11, { width: cardWidth - 24 });
            doc.font('Helvetica-Bold').fontSize(14).fillColor('#173d49').text(value, x + 12, cardY + 31, { width: cardWidth - 24 });
        });
        doc.y = cardY + 65;

        if (summary.recipes.length) {
            sectionTitle('Comidas previstas');
            bulletList(summary.recipes);
        }

        sectionTitle('Contenido de la cesta');
        if (!summary.items.length) {
            doc.font('Helvetica-Oblique').fontSize(10).fillColor('#66777d').text('No se han incluido productos en este informe.');
        }
        summary.items.forEach(item => {
            const price = item.price === null ? '' : formatMoney(item.price, summary.currency);
            const details = `${item.quantity} · ${STATUS_LABELS[item.status]}${price ? ` · ${price}` : ''}`;
            const nameHeight = doc.heightOfString(item.name, { width: pageWidth - 20 });
            ensureSpace(nameHeight + 31);
            const y = doc.y;
            doc.roundedRect(54, y, pageWidth, nameHeight + 25, 5).fill('#f7f9f8');
            doc.font('Helvetica-Bold').fontSize(10.2).fillColor('#1f3138')
                .text(item.name, 65, y + 8, { width: pageWidth - 22 });
            doc.font('Helvetica').fontSize(8.8).fillColor(STATUS_COLORS[item.status])
                .text(details, 65, y + 11 + nameHeight, { width: pageWidth - 22 });
            doc.y = y + nameHeight + 31;
        });

        if (summary.missing.length) {
            sectionTitle('Ingredientes o productos pendientes');
            bulletList(summary.missing, '#7f2d2a');
        }

        if (summary.notes.length) {
            sectionTitle('Notas para la revisión');
            bulletList(summary.notes);
        }

        sectionTitle('Siguiente paso');
        const reviewText = summary.test
            ? 'Este envío solo comprueba la notificación y el PDF. No se ha modificado ninguna cesta.'
            : 'La cesta está preparada para que Javier la revise. No se ha seleccionado entrega, introducido pago ni formalizado el pedido.';
        const reviewHeight = summary.basketUrl ? 73 : 53;
        ensureSpace(reviewHeight + 8);
        const reviewY = doc.y;
        doc.roundedRect(54, reviewY, pageWidth, reviewHeight, 6).fill('#e8f2ec');
        doc.font('Helvetica-Bold').fontSize(10.4).fillColor('#244f3e')
            .text(reviewText, 68, reviewY + 15, { width: pageWidth - 28 });
        if (summary.basketUrl) {
            doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#2563a6')
                .text('Abrir la cesta del supermercado', 68, reviewY + 49, {
                    width: pageWidth - 28,
                    link: summary.basketUrl,
                    underline: true,
                });
        }
        doc.y = reviewY + reviewHeight + 10;

        const range = doc.bufferedPageRange();
        for (let index = range.start; index < range.start + range.count; index += 1) {
            doc.switchToPage(index);
            const originalBottomMargin = doc.page.margins.bottom;
            doc.page.margins.bottom = 0;
            doc.font('Helvetica').fontSize(8).fillColor('#7b888d')
                .text(`Kitchen Dashboard · página ${index - range.start + 1} de ${range.count}`, 54, doc.page.height - 36, {
                    width: pageWidth,
                    align: 'center',
                    lineBreak: false,
                });
            doc.page.margins.bottom = originalBottomMargin;
        }

        doc.end();
    });
}

function requestBuffer(urlValue, { method = 'GET', headers = {}, body = null } = {}) {
    const url = urlValue instanceof URL ? urlValue : new URL(urlValue);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        return Promise.reject(new Error('Unsupported upload URL protocol'));
    }
    const client = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const req = client.request(url, { method, headers }, res => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const responseBody = Buffer.concat(chunks);
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`Pushbullet request failed with HTTP ${res.statusCode}`));
                    return;
                }
                resolve({ statusCode: res.statusCode, headers: res.headers, body: responseBody });
            });
        });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
    });
}

async function pushbulletJson(token, apiPath, payload) {
    if (!token) throw new Error('PUSHBULLET_TOKEN is not configured');
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const response = await requestBuffer(new URL(apiPath, 'https://api.pushbullet.com'), {
        method: 'POST',
        headers: {
            'Access-Token': token,
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
        },
        body,
    });
    try {
        return JSON.parse(response.body.toString('utf8'));
    } catch (error) {
        throw new Error('Pushbullet returned an invalid JSON response');
    }
}

function multipartField(boundary, name, value) {
    return Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${String(name).replace(/"/g, '')}"\r\n\r\n${String(value)}\r\n`,
        'utf8',
    );
}

async function uploadPushbulletFile(uploadRequest, filePath) {
    const boundary = `kitchen-${crypto.randomBytes(12).toString('hex')}`;
    const chunks = [];
    Object.entries(uploadRequest.data || {}).forEach(([name, value]) => {
        chunks.push(multipartField(boundary, name, value));
    });
    const safeName = path.basename(uploadRequest.file_name || filePath).replace(/["\r\n]/g, '_');
    chunks.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeName}"\r\nContent-Type: application/pdf\r\n\r\n`,
        'utf8',
    ));
    chunks.push(fs.readFileSync(filePath));
    chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'));
    const body = Buffer.concat(chunks);
    await requestBuffer(uploadRequest.upload_url, {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': String(body.length),
        },
        body,
    });
}

async function sendOrderReadyPush({ token, summary: input, pdfPath, idempotencyKey }) {
    const summary = normalizeOrderSummary(input);
    const fileName = path.basename(pdfPath);
    const uploadRequest = await pushbulletJson(token, '/v2/upload-request', {
        file_name: fileName,
        file_type: 'application/pdf',
    });
    if (!uploadRequest.upload_url || !uploadRequest.file_url) {
        throw new Error('Pushbullet did not return an upload URL');
    }
    await uploadPushbulletFile(uploadRequest, pdfPath);

    const readyCount = summary.items.filter(item => ['added', 'already-present'].includes(item.status)).length;
    const issueCount = summary.items.filter(item => ['missing', 'manual'].includes(item.status)).length + summary.missing.length;
    const title = summary.test
        ? '[PRUEBA] Compra preparada para revisión'
        : `Compra de ${summary.store} preparada para revisión`;
    const totalText = summary.total === null ? '' : ` · ${formatMoney(summary.total, summary.currency)}`;
    const body = summary.test
        ? 'Prueba de Kitchen: el PDF adjunto no corresponde a un pedido real.'
        : `${readyCount} productos listos · ${issueCount} pendientes${totalText}. Revisa la cesta antes de formalizar el pedido.`;

    return pushbulletJson(token, '/v2/pushes', {
        type: 'file',
        title,
        body,
        file_name: uploadRequest.file_name || fileName,
        file_type: uploadRequest.file_type || 'application/pdf',
        file_url: uploadRequest.file_url,
        guid: crypto.createHash('sha256').update(idempotencyKey).digest('hex'),
    });
}

module.exports = {
    normalizeOrderSummary,
    createOrderSummaryPdf,
    sendOrderReadyPush,
    formatMoney,
};
