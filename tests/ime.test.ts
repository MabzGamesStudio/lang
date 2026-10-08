import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phoneticScheme, transliterate, toDevanagari } from '../shared/ime/transliterate.js';
import { romajiToHiragana, hiraganaToKatakana, katakanaToHiragana } from '../shared/ime/kana.js';
import { hangulFromKeys } from '../shared/ime/hangul.js';
import { prepareEntries, resolveInputMethod, searchCandidates } from '../shared/ime/index.js';

test('automatic input method per language', () => {
  assert.equal(resolveInputMethod('auto', 'zh'), 'pinyin');
  assert.equal(resolveInputMethod('auto', 'ja'), 'japanese');
  assert.equal(resolveInputMethod('auto', 'ko'), 'hangul');
  assert.equal(resolveInputMethod('auto', 'ru'), 'phonetic');
  assert.equal(resolveInputMethod('auto', 'es'), 'letters');
  assert.equal(resolveInputMethod('auto', 'ar'), 'letters');
  assert.equal(resolveInputMethod('phonetic', 'es'), 'letters', 'no phonetic scheme for Latin scripts');
  assert.equal(resolveInputMethod('system', 'zh'), 'system');
});

test('phonetic Cyrillic and Greek', () => {
  const ru = phoneticScheme('ru')!;
  assert.equal(transliterate('privet', ru), 'привет');
  assert.equal(transliterate('Moskva', ru), 'Москва');
  assert.equal(transliterate('shchi', ru), 'щи');
  assert.equal(transliterate('zhenshchina', ru), 'женщина');
  assert.equal(transliterate("den'", ru), 'день');
  assert.equal(transliterate('yabloko', ru), 'яблоко');
  assert.equal(transliterate('s|hema', ru), 'схема', '| keeps letters apart');
  assert.equal(transliterate('dobryj', ru), 'добрый');
  const uk = phoneticScheme('uk')!;
  assert.equal(transliterate('dyakuyu', uk), 'дякую');
  assert.equal(transliterate('yizhak', uk), 'їжак');
  const sr = phoneticScheme('sr')!;
  assert.equal(transliterate('ljubav', sr), 'љубав');
  assert.equal(transliterate('čovek', sr), 'човек');
  const el = phoneticScheme('el')!;
  assert.equal(transliterate("kalhme'ra", el), 'καλημέρα');
  assert.equal(transliterate('logos', el), 'λογος', 'final sigma');
  assert.equal(transliterate('thalassa', el), 'θαλασσα');
});

test('phonetic Devanagari', () => {
  assert.equal(toDevanagari('namaste'), 'नमस्ते');
  assert.equal(toDevanagari('hindii'), 'हिन्दी');
  assert.equal(toDevanagari('bhaarat'), 'भारत');
  assert.equal(toDevanagari('kyaa'), 'क्या');
  assert.equal(toDevanagari('hai'), 'है');
  assert.equal(toDevanagari('mai.n'), 'मैं');
  assert.equal(toDevanagari('aap'), 'आप');
});

test('romaji to kana', () => {
  assert.equal(romajiToHiragana('nihongo'), 'にほんご');
  assert.equal(romajiToHiragana('konnichiha'), 'こんにちは');
  assert.equal(romajiToHiragana('kitte'), 'きって');
  assert.equal(romajiToHiragana('matcha'), 'まっちゃ');
  assert.equal(romajiToHiragana('toukyou'), 'とうきょう');
  assert.equal(romajiToHiragana("hon'ya"), 'ほんや');
  assert.equal(romajiToHiragana('shinbun'), 'しんぶn', 'a trailing n waits for the next key');
  assert.equal(romajiToHiragana('shinbun', true), 'しんぶん');
  assert.equal(romajiToHiragana('ky'), 'ky', 'unfinished syllables stay Latin');
  assert.equal(hiraganaToKatakana('こーひー'), 'コーヒー');
  assert.equal(katakanaToHiragana('テレビ'), 'てれび');
});

test('2-set Hangul composition', () => {
  assert.equal(hangulFromKeys('dkssudgktpdy'), '안녕하세요');
  assert.equal(hangulFromKeys('gksrnr'), '한국');
  assert.equal(hangulFromKeys('rkqt'), '값', 'compound final consonant');
  assert.equal(hangulFromKeys('rkqtdl'), '값이', 'ㅇ (d) starts the next syllable');
  assert.equal(hangulFromKeys('rkqtl'), '갑시', 'the last final consonant moves to the next syllable');
  assert.equal(hangulFromKeys('dhkd'), '왕', 'compound vowel');
  assert.equal(hangulFromKeys('Tkd'), '쌍', 'shift gives tense consonants');
});

test('pinyin and kana candidates', () => {
  const pinyin = prepareEntries(
    [
      ['学生', "xue'sheng", 50],
      ['学', 'xue', 120],
      ['学校', "xue'xiao", 80],
      ['雪', 'xue', 900],
      ['绿', 'lv', 300],
    ],
    'pinyin'
  );
  assert.deepEqual(searchCandidates(pinyin, 'xuesheng'), ['学生']);
  assert.deepEqual(searchCandidates(pinyin, 'xue'), ['学', '雪', '学生', '学校']);
  assert.deepEqual(searchCandidates(pinyin, 'xs'), ['学生']);
  assert.deepEqual(searchCandidates(pinyin, 'xx'), ['学校']);
  assert.deepEqual(searchCandidates(pinyin, 'lü'), ['绿']);
  const kana = prepareEntries([['日本', 'にほん', 10], ['日本語', 'にほんご', 40]], 'japanese');
  assert.deepEqual(searchCandidates(kana, 'にほん'), ['日本', '日本語']);
});
