import AVFoundation
import CoreAudio
import CoreMedia
import Foundation

enum AudioLevelSampler {
    static func linearLevel(fromDecibels decibels: Float) -> Double {
        guard decibels.isFinite else { return 0 }
        let clamped = max(-60, min(0, decibels))
        return min(1, pow(10, Double(clamped) / 20) * 3)
    }

    static func linearLevel(from sampleBuffer: CMSampleBuffer) -> Double? {
        guard
            let format = CMSampleBufferGetFormatDescription(sampleBuffer),
            let streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(format),
            let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer)
        else {
            return nil
        }

        let byteLength = CMBlockBufferGetDataLength(blockBuffer)
        guard byteLength > 0 else { return nil }

        var data = Data(count: byteLength)
        let copyStatus = data.withUnsafeMutableBytes { buffer in
            guard let baseAddress = buffer.baseAddress else { return OSStatus(paramErr) }
            return CMBlockBufferCopyDataBytes(
                blockBuffer,
                atOffset: 0,
                dataLength: byteLength,
                destination: baseAddress
            )
        }
        guard copyStatus == noErr else { return nil }

        let description = streamDescription.pointee
        if description.mBitsPerChannel == 32,
           description.mFormatFlags & kAudioFormatFlagIsFloat != 0 {
            return level(fromFloat32Data: data)
        }

        if description.mBitsPerChannel == 16 {
            return level(fromInt16Data: data)
        }

        return nil
    }

    private static func level(fromFloat32Data data: Data) -> Double? {
        data.withUnsafeBytes { rawBuffer in
            let samples = rawBuffer.bindMemory(to: Float.self)
            guard !samples.isEmpty else { return nil }
            return normalizedLevel(samples: samples.count) { Double(samples[$0]) }
        }
    }

    private static func level(fromInt16Data data: Data) -> Double? {
        data.withUnsafeBytes { rawBuffer in
            let samples = rawBuffer.bindMemory(to: Int16.self)
            guard !samples.isEmpty else { return nil }
            return normalizedLevel(samples: samples.count) {
                Double(samples[$0]) / Double(Int16.max)
            }
        }
    }

    private static func normalizedLevel(
        samples: Int,
        valueAt: (Int) -> Double
    ) -> Double {
        let maxSamples = 4096
        let stride = max(1, samples / maxSamples)
        var sum = 0.0
        var count = 0
        var index = 0

        while index < samples {
            let value = valueAt(index)
            sum += value * value
            count += 1
            index += stride
        }

        guard count > 0 else { return 0 }
        let rms = sqrt(sum / Double(count))
        return min(1, max(0, rms * 8))
    }
}
