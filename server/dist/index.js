"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const client_1 = require("@prisma/client");
const location_1 = __importDefault(require("./routes/location"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const user_1 = __importDefault(require("./routes/user"));
const callback_1 = __importDefault(require("./routes/callback"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)('dev'));
app.use(express_1.default.json());
app.use('/api/location', location_1.default);
app.use('/api/catalog', catalog_1.default);
app.use('/api/users', user_1.default);
app.use('/api/callback', callback_1.default);
app.get('/', (req, res) => {
    res.send('DOCNOW API is running');
});
exports.prisma = new client_1.PrismaClient();
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
