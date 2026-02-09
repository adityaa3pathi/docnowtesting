"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPhleboContact = exports.getReschedulableSlots = exports.rescheduleBooking = exports.cancelBooking = exports.getStatus = exports.listBookings = exports.createBooking = void 0;
// Booking Controllers - Clean exports for route wiring
var create_1 = require("./create");
Object.defineProperty(exports, "createBooking", { enumerable: true, get: function () { return create_1.createBooking; } });
var list_1 = require("./list");
Object.defineProperty(exports, "listBookings", { enumerable: true, get: function () { return list_1.listBookings; } });
var status_1 = require("./status");
Object.defineProperty(exports, "getStatus", { enumerable: true, get: function () { return status_1.getStatus; } });
var cancel_1 = require("./cancel");
Object.defineProperty(exports, "cancelBooking", { enumerable: true, get: function () { return cancel_1.cancelBooking; } });
var reschedule_1 = require("./reschedule");
Object.defineProperty(exports, "rescheduleBooking", { enumerable: true, get: function () { return reschedule_1.rescheduleBooking; } });
var slots_1 = require("./slots");
Object.defineProperty(exports, "getReschedulableSlots", { enumerable: true, get: function () { return slots_1.getReschedulableSlots; } });
var phlebo_1 = require("./phlebo");
Object.defineProperty(exports, "getPhleboContact", { enumerable: true, get: function () { return phlebo_1.getPhleboContact; } });
