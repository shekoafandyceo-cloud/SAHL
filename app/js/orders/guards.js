// حراس الصلاحية والمستأجر — بيتنادوا من كل المجالات تقريباً

import { currentRole, hasTenant } from '../auth/auth.js';
import { toast } from '../core/toast.js';

export function ensureTenant(){if(!hasTenant()){toast('حصلت مشكلة في الحساب. تواصل مع الدعم.','er');return false;}return true;}

export function isAdmin(){return currentRole==='admin';}

export function requireAdmin(){if(!isAdmin()){toast('الصلاحية دي للأدمن فقط','er');return false;}return true;}
