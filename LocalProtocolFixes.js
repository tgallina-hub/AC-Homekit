// v1.6.0 omits the final reserved byte in the legacy display command.
// Keep the correction limited to the known 19-byte body; future fixed bodies pass through.
export function patchDisplayCommand(MessageSwitchDisplay) {
    if (MessageSwitchDisplay.prototype.localDisplayFix) return;
    MessageSwitchDisplay.prototype.localDisplayFix = true;
    const originalBody = Object.getOwnPropertyDescriptor(MessageSwitchDisplay.prototype, '_body').get;
    Object.defineProperty(MessageSwitchDisplay.prototype, '_body', {
        configurable: true,
        get() {
            const body = originalBody.call(this);
            return body.length === 19 ? Buffer.concat([body, Buffer.from([0])]) : body;
        },
    });
}
