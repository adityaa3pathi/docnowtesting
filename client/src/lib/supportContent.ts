import 'server-only';

import { cache } from 'react';
import { access, readFile } from 'fs/promises';
import path from 'path';

export type SupportBlock =
    | { type: 'paragraph'; text: string }
    | { type: 'list'; items: string[] };

export type SupportSection = {
    title: string;
    blocks: SupportBlock[];
    subsections?: SupportSection[];
};

export type SupportFaqItem = {
    number: string;
    question: string;
    blocks: SupportBlock[];
};

export type SupportPageContent = {
    title: string;
    subtitle?: string;
    intro: SupportBlock[];
    sections: SupportSection[];
};

const FAQ_SOURCE_FILE = 'Frequently Asked Questions.md';

const readSupportSource = cache(async () => {
    const candidatePaths = [
        path.resolve(process.cwd(), FAQ_SOURCE_FILE),
        path.resolve(process.cwd(), '..', FAQ_SOURCE_FILE),
    ];

    for (const candidatePath of candidatePaths) {
        try {
            await access(candidatePath);
            return readFile(candidatePath, 'utf8');
        } catch {
            // Try the next possible project root.
        }
    }

    throw new Error(`Unable to locate ${FAQ_SOURCE_FILE}.`);
});

function cleanInlineMarkdown(text: string) {
    return text
        .replace(/\\\./g, '.')
        .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#+\s*/, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function parseBlocks(raw: string): SupportBlock[] {
    const lines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line !== '---');

    const blocks: SupportBlock[] = [];
    let paragraphBuffer: string[] = [];
    let listBuffer: string[] = [];

    const flushParagraph = () => {
        if (!paragraphBuffer.length) return;
        blocks.push({
            type: 'paragraph',
            text: cleanInlineMarkdown(paragraphBuffer.join(' ')),
        });
        paragraphBuffer = [];
    };

    const flushList = () => {
        if (!listBuffer.length) return;
        blocks.push({
            type: 'list',
            items: listBuffer.map((item) => cleanInlineMarkdown(item.replace(/^\*\s*/, ''))),
        });
        listBuffer = [];
    };

    for (const line of lines) {
        if (line.startsWith('* ')) {
            flushParagraph();
            listBuffer.push(line);
            continue;
        }

        if (line.startsWith('### ')) {
            flushParagraph();
            flushList();
            blocks.push({
                type: 'paragraph',
                text: cleanInlineMarkdown(line),
            });
            continue;
        }

        flushList();
        paragraphBuffer.push(line);
    }

    flushParagraph();
    flushList();

    return blocks;
}

function parseSections(raw: string): SupportSection[] {
    const headingPattern = /^##\s+\*\*(.+?)\*\*\s*$/gm;
    const matches = [...raw.matchAll(headingPattern)];

    return matches.map((match, index) => {
        const title = cleanInlineMarkdown(match[1]);
        const start = match.index! + match[0].length;
        const end = matches[index + 1]?.index ?? raw.length;
        const body = raw.slice(start, end).trim();

        const subsectionPattern = /^###\s+\*\*(.+?)\*\*\s*$/gm;
        const subsectionMatches = [...body.matchAll(subsectionPattern)];

        if (!subsectionMatches.length) {
            return {
                title,
                blocks: parseBlocks(body),
            };
        }

        const intro = body.slice(0, subsectionMatches[0].index).trim();
        const subsections = subsectionMatches.map((subsectionMatch, subsectionIndex) => {
            const subsectionTitle = cleanInlineMarkdown(subsectionMatch[1]);
            const subsectionStart = subsectionMatch.index! + subsectionMatch[0].length;
            const subsectionEnd = subsectionMatches[subsectionIndex + 1]?.index ?? body.length;
            const subsectionBody = body.slice(subsectionStart, subsectionEnd).trim();

            return {
                title: subsectionTitle,
                blocks: parseBlocks(subsectionBody),
            };
        });

        return {
            title,
            blocks: parseBlocks(intro),
            subsections,
        };
    });
}

function parseSupportPage(raw: string, pageTitle: string): SupportPageContent {
    const titlePattern = new RegExp(`^#\\s+\\*\\*${pageTitle}\\*\\*\\s*$`, 'm');
    const titleMatch = raw.match(titlePattern);

    if (!titleMatch) {
        throw new Error(`Unable to locate page section "${pageTitle}" in ${FAQ_SOURCE_FILE}.`);
    }

    const sectionStart = titleMatch.index! + titleMatch[0].length;
    const remaining = raw.slice(sectionStart).trim();
    const nextPageMatch = remaining.match(/^#\s+\*\*.+?\*\*\s*$/m);
    const pageBody = nextPageMatch ? remaining.slice(0, nextPageMatch.index).trim() : remaining;

    const subtitleMatch = pageBody.match(/^###\s+\*\*\*(.+?)\*\*\*\s*$/m);
    const subtitle = subtitleMatch ? cleanInlineMarkdown(subtitleMatch[1]) : undefined;
    const contentWithoutSubtitle = subtitleMatch
        ? pageBody.replace(subtitleMatch[0], '').trim()
        : pageBody;

    const firstSectionMatch = contentWithoutSubtitle.match(/^##\s+\*\*.+?\*\*\s*$/m);
    const introRaw = firstSectionMatch
        ? contentWithoutSubtitle.slice(0, firstSectionMatch.index).trim()
        : contentWithoutSubtitle;
    const sectionsRaw = firstSectionMatch
        ? contentWithoutSubtitle.slice(firstSectionMatch.index).trim()
        : '';

    return {
        title: pageTitle,
        subtitle,
        intro: parseBlocks(introRaw),
        sections: parseSections(sectionsRaw),
    };
}

function parseFaqs(raw: string): SupportFaqItem[] {
    const faqSection = raw.split('# **DocNow Help Centre**')[0];
    const lines = faqSection.split('\n');
    const items: SupportFaqItem[] = [];
    let currentItem: { number: string; question: string; lines: string[] } | null = null;

    const questionPattern = /^(?:###\s*)?\*\*(\d+)\\\.\s*(.+?)\*\*\s*$/;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line || line === '---' || line === '## **Frequently Asked Questions**') {
            continue;
        }

        if (line.includes('SEO-optimized Help Centre page')) {
            continue;
        }

        const questionMatch = line.match(questionPattern);

        if (questionMatch) {
            if (currentItem) {
                items.push({
                    number: currentItem.number,
                    question: currentItem.question,
                    blocks: parseBlocks(currentItem.lines.join('\n')),
                });
            }

            currentItem = {
                number: questionMatch[1],
                question: cleanInlineMarkdown(questionMatch[2]),
                lines: [],
            };

            continue;
        }

        if (currentItem) {
            currentItem.lines.push(rawLine);
        }
    }

    if (currentItem) {
        items.push({
            number: currentItem.number,
            question: currentItem.question,
            blocks: parseBlocks(currentItem.lines.join('\n')),
        });
    }

    return items;
}

export const getSupportFaqs = cache(async () => {
    const source = await readSupportSource();
    return parseFaqs(source);
});

export const getHelpCenterContent = cache(async () => {
    const source = await readSupportSource();
    return parseSupportPage(source, 'DocNow Help Centre');
});

export const getContactPageContent = cache(async () => {
    const source = await readSupportSource();
    return parseSupportPage(source, 'Contact DocNow');
});
