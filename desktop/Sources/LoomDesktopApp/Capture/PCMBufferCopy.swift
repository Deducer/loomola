import AVFoundation
import Foundation

extension AVAudioPCMBuffer {
    func loomolaCopyForAsyncUse() -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: frameLength
        ) else { return nil }
        copy.frameLength = frameLength

        let sourceBuffers = UnsafeMutableAudioBufferListPointer(
            UnsafeMutablePointer(mutating: audioBufferList)
        )
        let destinationBuffers = UnsafeMutableAudioBufferListPointer(
            copy.mutableAudioBufferList
        )
        let count = min(sourceBuffers.count, destinationBuffers.count)
        for index in 0..<count {
            guard let source = sourceBuffers[index].mData,
                  let destination = destinationBuffers[index].mData
            else { continue }
            let byteCount = min(
                Int(sourceBuffers[index].mDataByteSize),
                Int(destinationBuffers[index].mDataByteSize)
            )
            memcpy(destination, source, byteCount)
            destinationBuffers[index].mDataByteSize = UInt32(byteCount)
        }

        return copy
    }
}
