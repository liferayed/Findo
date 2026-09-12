const { buildChatReply } = require('../src/chat/buildChatReply');

describe('buildChatReply', () => {
  test('echoes the original message back to the user', () => {
    const reply = buildChatReply('Spent $12 at Starbucks');
    expect(reply).toContain('Spent $12 at Starbucks');
  });

  test('makes clear that general question-answering is not supported yet', () => {
    const reply = buildChatReply('hello');
    expect(reply.toLowerCase()).toContain("can't answer general questions yet");
  });
});
