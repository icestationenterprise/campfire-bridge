export function formatTime(ms: number): string {
const minutes = Math.floor(ms / 60000);
const seconds = Math.floor((ms % 60000) / 1000);
return ${minutes}:${seconds < 10 ? '0' : ''}${seconds};
}

export function validateIpAddress(ip: string): boolean {
const ipRegex = /^(\d{1,3}.){3}\d{1,3}$/;
if (!ipRegex.test(ip)) return false;

const parts = ip.split('.');
return parts.every(part => parseInt(part, 10) <= 255);
}

export function debounce(func: Function, wait: number) {
let timeout: NodeJS.Timeout;
return function executedFunction(...args: any[]) {
const later = () => {
clearTimeout(timeout);
func(...args);
};
clearTimeout(timeout);
timeout = setTimeout(later, wait);
};
}
