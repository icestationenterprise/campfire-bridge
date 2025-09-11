import ApiService from '../../src/services/api';

jest.mock('axios', () => ({
post: jest.fn(),
get: jest.fn(),
}));

describe('ApiService', () => {
beforeEach(() => {
jest.clearAllMocks();
});

test('login should return token', async () => {
const mockToken = 'test-token';
(require('axios').post as jest.Mock).mockResolvedValue({ data: { token: mockToken } });

const token = await ApiService.login('password');
expect(token).toBe(mockToken);
});
});
