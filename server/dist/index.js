"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const dotenv_1 = __importDefault(require("dotenv"));
const location_1 = __importDefault(require("./routes/location"));
const catalog_1 = __importDefault(require("./routes/catalog"));
const user_1 = __importDefault(require("./routes/user"));
const callback_1 = __importDefault(require("./routes/callback"));
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const patients_1 = __importDefault(require("./routes/patients"));
const addresses_1 = __importDefault(require("./routes/addresses"));
const cart_1 = __importDefault(require("./routes/cart"));
const slots_1 = __importDefault(require("./routes/slots"));
const bookings_1 = __importDefault(require("./routes/bookings"));
const admin_1 = __importDefault(require("./routes/admin"));
const payments_1 = __importStar(require("./routes/payments"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 5000;
app.use((0, cors_1.default)());
app.use((0, helmet_1.default)());
app.use((0, morgan_1.default)('dev'));
// CRITICAL: Webhook must be mounted BEFORE express.json() to get raw body
app.post('/api/payments/webhook', express_1.default.raw({ type: 'application/json' }), payments_1.webhookHandler);
app.use(express_1.default.json());
app.use('/api/location', location_1.default);
app.use('/api/catalog', catalog_1.default);
app.use('/api/users', user_1.default);
app.use('/api/callback', callback_1.default);
app.use('/api/auth', auth_1.default);
app.use('/api/profile', profile_1.default);
app.use('/api/profile/patients', patients_1.default);
app.use('/api/profile/addresses', addresses_1.default);
app.use('/api/cart', cart_1.default);
app.use('/api/slots', slots_1.default);
console.log('Mounting /api/bookings. bookingRoutes type:', typeof bookings_1.default);
app.use('/api/bookings', bookings_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/payments', payments_1.default);
app.get('/', (req, res) => {
    res.send('DOCNOW API is running');
});
// export const prisma = new PrismaClient();
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
