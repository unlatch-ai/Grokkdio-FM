# Dynamic Text Overlay

Show temporary text messages during the podcast!

## Usage

While the podcast is running, type:

```bash
text: Your message here
```

The text will:
- ✅ Display for 5 seconds
- ✅ Auto-disappear
- ✅ Can be triggered anytime
- ✅ Works with both local and Twitch modes

## Examples

### Show a message
```bash
> text: Welcome to the show!
📝 Overlay: "Welcome to the show!"
```

### Announce something
```bash
> text: New sponsor: TechCorp!
```

### Call to action
```bash
> text: Subscribe at twitch.tv/yourname
```

### Event notification
```bash
> text: Q&A starting in 5 minutes
```

## Combined with Other Features

### Breaking news with text
```bash
> breaking: Major AI breakthrough
> text: BREAKING NEWS
```

### User comment with text
```bash
> What do you think about AGI?
> text: Viewer question from @username
```

## Programmatic API

```javascript
// In your code
orchestrator.textOverlay.showText('Custom message', 5000);

// Custom duration (10 seconds)
orchestrator.textOverlay.showText('Longer message', 10000);

// Hide immediately
orchestrator.textOverlay.hideText();

// Check if showing
if (orchestrator.textOverlay.isShowing()) {
  console.log(orchestrator.textOverlay.getText());
}
```

## Future Enhancements

For true visual overlays on the video stream, consider:

### Option 1: OBS Integration
- Use OBS with browser source
- Send text via WebSocket
- Full control over styling and animations

### Option 2: Separate Overlay Tool
- Use tools like Streamlabs or StreamElements
- Trigger via API
- Professional overlays and alerts

### Option 3: FFmpeg Restart (Not Recommended)
- Restart FFmpeg with new text filter
- Causes brief interruption
- Not ideal for live streaming

## Current Implementation

The text overlay is currently logged to console. To see it on video, you would need to integrate with external tools like OBS or implement a more complex video compositing solution.

For Twitch streaming, consider using:
- Twitch alerts
- StreamElements
- OBS overlays
- Browser sources

The infrastructure is in place - just needs visual rendering!
