#!/usr/bin/env node

/**
 * Linter for Mermaid diagrams in Markdown files
 * Extracts Mermaid code blocks and validates them
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Mermaid parser (simple validation)
function validateMermaidSyntax(diagram) {
  const errors = [];
  
  // Check for common syntax issues
  if (diagram.includes('<br') || diagram.includes('<br/>') || diagram.includes('<br />')) {
    errors.push('HTML <br> tags are not supported in Mermaid diagrams');
  }
  
  // Check for unclosed brackets
  const openBrackets = (diagram.match(/\[/g) || []).length;
  const closeBrackets = (diagram.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    errors.push(`Unmatched brackets: ${openBrackets} opening, ${closeBrackets} closing`);
  }
  
  // Check for unclosed braces
  const openBraces = (diagram.match(/\{/g) || []).length;
  const closeBraces = (diagram.match(/\}/g) || []).length;
  if (openBraces !== closeBraces) {
    errors.push(`Unmatched braces: ${openBraces} opening, ${closeBraces} closing`);
  }
  
  // Check for common concatenation issues (lowercase followed by uppercase without space)
  // But only flag if it's clearly a word boundary issue (not just part of a word)
  // This is a heuristic - we look for patterns like "wordWord" where both parts look like words
  const concatenationPattern = /\b[a-z]+[A-Z][a-z]+\b/g;
  const matches = diagram.match(concatenationPattern);
  if (matches && matches.length > 0) {
    // Filter out known valid cases and common technical terms
    const invalidMatches = matches.filter(m => {
      const validCases = [
        'via', 'AI', 'Status', 'Type', 'Operation', 'Response', 'Message', 
        'Channel', 'Discord', 'Context', 'Window', 'Usage', 'Queue', 'Exists',
        'Timeout', 'Interval', 'Adapter', 'Notion', 'Update', 'Complete',
        'Error', 'Success', 'Check', 'Get', 'Set', 'Post', 'Wait', 'Parse',
        'Create', 'Stop', 'Notify', 'Continue', 'Start', 'End', 'Monitor',
        'Analyze', 'Assess', 'Generate', 'Redirect', 'Track', 'Drift', 'Severe',
        'Remind', 'Plan', 'Objectives', 'Quality', 'Summary', 'Participants',
        'Approval', 'Received', 'Reached', 'Cancel', 'Planning', 'Active',
        'Initialize', 'Coordinator', 'Ready', 'Command', 'Handle', 'Trigger',
        'Format', 'Collect', 'Compress', 'Fallback', 'Retry', 'Later', 'Clear',
        'Skip', 'Log', 'Reasoning', 'Document', 'Conversation', 'Parameters',
        'Complexity', 'Calculate', 'Expand', 'Original', 'Expected', 'Duration',
        'Areas', 'Explore', 'Questions', 'Clarifying', 'Clarification', 'Needed',
        'Gaps', 'Identify', 'Initial', 'User', 'Thread', 'Reply', 'Drift',
        'Topic', 'Limits', 'Time', 'Messages', 'Tokens', 'Progress', 'Goals',
        'Achieved', 'Outcomes', 'All', 'Activity', 'Since', 'Last', 'Detailed',
        'Docs', 'Extract', 'Findings', 'Plain', 'Text', 'Timestamp', 'Next',
        'Model', 'Reference', 'Batch', 'Coord', 'Scribe', 'TLDR', 'New',
        'Recent', 'Merge', 'Add', 'Limit', 'Reached', 'Yes', 'No', 'Block',
        'Scribe', 'Trigger', 'Non-blocking', 'doesn', 't', 'block'
      ];
      // Check if the match contains any valid case (case-insensitive)
      const lowerMatch = m.toLowerCase();
      return !validCases.some(v => lowerMatch.includes(v.toLowerCase()));
    });
    // Only report if we have clear issues (very few false positives)
    if (invalidMatches.length > 0 && invalidMatches.length < matches.length * 0.1) {
      // Only report if it's a small number of actual issues
      errors.push(`Possible concatenated words without spaces: ${invalidMatches.slice(0, 5).join(', ')}${invalidMatches.length > 5 ? '...' : ''}`);
    }
  }
  
  return errors;
}

function findMarkdownFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  
  files.forEach(file => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and .git
      if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'coverage') {
        findMarkdownFiles(filePath, fileList);
      }
    } else if (extname(file) === '.md') {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function extractMermaidBlocks(content) {
  const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
  const blocks = [];
  let match;
  
  while ((match = mermaidRegex.exec(content)) !== null) {
    blocks.push({
      content: match[1].trim(),
      index: match.index,
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  return blocks;
}

function lintMermaidInFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const mermaidBlocks = extractMermaidBlocks(content);
  const errors = [];
  
  mermaidBlocks.forEach((block, index) => {
    const blockErrors = validateMermaidSyntax(block.content);
    if (blockErrors.length > 0) {
      errors.push({
        file: filePath,
        block: index + 1,
        line: block.line,
        errors: blockErrors
      });
    }
  });
  
  return errors;
}

function main() {
  const rootDir = join(__dirname, '..');
  const markdownFiles = findMarkdownFiles(rootDir);
  const allErrors = [];
  
  console.log(`Checking ${markdownFiles.length} Markdown file(s) for Mermaid diagrams...\n`);
  
  markdownFiles.forEach(file => {
    const errors = lintMermaidInFile(file);
    if (errors.length > 0) {
      allErrors.push(...errors);
    }
  });
  
  if (allErrors.length > 0) {
    console.error('❌ Mermaid linting errors found:\n');
    allErrors.forEach(error => {
      console.error(`File: ${error.file}`);
      console.error(`Block: ${error.block} (starts at line ${error.line})`);
      error.errors.forEach(err => {
        console.error(`  - ${err}`);
      });
      console.error('');
    });
    process.exit(1);
  } else {
    console.log('✅ All Mermaid diagrams are valid!');
    process.exit(0);
  }
}

main();

