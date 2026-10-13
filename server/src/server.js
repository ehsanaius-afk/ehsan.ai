import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import mammoth from 'mammoth';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

const app = express();
const port = Number(process.env.PORT || 8000);
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const upload = multer({
  dest: path.join(os.tmpdir(), 'ehsan-ai'),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ai: Boolean(client),
    model
  });
});

async function extractFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = await fs.readFile(file.path);

  const textExtensions = [
    '.txt', '.md', '.csv', '.js', '.ts', '.jsx',
    '.tsx', '.py', '.java', '.cpp', '.html', '.css', '.json'
  ];

  if (textExtensions.includes(ext)) {
    return buffer.toString('utf8').slice(0, 120000);
  }

  if (ext === '.pdf') {
    const result = await pdfParse(buffer);
    return result.text.slice(0, 120000);
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.slice(0, 120000);
  }

  return null;
}

app.post('/api/chat', upload.array('files', 5), async (req, res) => {
  const files = req.files || [];

  try {
    if (!client) {
      return res.status(503).json({
        error: 'کلید API تنظیم نشده است. فایل .env را بررسی کنید.'
      });
    }

    const message = String(req.body.message || '').trim();

    if (!message) {
      return res.status(400).json({ error: 'پیام خالی است.' });
    }

    let history = [];
    try {
      history = JSON.parse(req.body.history || '[]');
    } catch {
      history = [];
    }

    let fileContext = '';

    for (const file of files) {
      const extracted = await extractFile(file);

      if (extracted) {
        fileContext +=
          '\n\n--- File: ' + file.originalname + ' ---\n' + extracted;
      }
    }

    const input = [
      ...history
        .filter(item => item.role === 'user' || item.role === 'assistant')
        .slice(-12),
      {
        role: 'user',
        content: message +
          (fileContext
            ? '\n\nContent of uploaded files:\n' + fileContext
            : '')
      }
    ];

    const params = {
      model,
      input,
      instructions:
        'You are EHSAN AI, a helpful and accurate Persian-speaking assistant. ' +
        'Respond clearly and honestly. If you do not know something, say so.'
    };

    if (String(req.body.webSearch) === 'true') {
      params.tools = [{ type: 'web_search' }];
    }

    const response = await client.responses.create(params);

    return res.json({
      content: response.output_text || 'پاسخی دریافت نشد.',
      sources: []
    });
  } catch (error) {
    console.error('Chat error:', error.message);

    return res.status(500).json({
      error: 'خطا در دریافت پاسخ. تنظیمات API و مدل را بررسی کنید.'
    });
  } finally {
    await Promise.all(
      files.map(file => fs.unlink(file.path).catch(() => {}))
    );
  }
});

app.listen(port, () => {
  console.log(`EHSAN AI server listening on http://localhost:${port}`);
});